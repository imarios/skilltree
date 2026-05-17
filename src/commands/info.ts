import semver from "semver";
import { manifestExists } from "../core/filenames.js";
import { listTags } from "../core/git.js";
import { readLockfile } from "../core/lockfile.js";
import { expandSources, readManifest } from "../core/manifest.js";
import { getRegistryRepoDir, loadFreshRegistryIndex } from "../core/registry-cache.js";
import { listRegistries } from "../core/registry-config.js";
import { dim, label, pc } from "../core/ui.js";
import type { Dependency, IndexEntry, LockfileEntry, Manifest } from "../types.js";
import { isLocalDependency, isRemoteDependency, isSourceDependency } from "../types.js";

interface LockfileMatch {
	layer: "lockfile";
	name: string;
	entry: LockfileEntry;
}

interface ManifestMatch {
	layer: "manifest";
	name: string;
	dep: Dependency;
	group: "prod" | "dev";
}

interface RegistryMatch {
	layer: "registry";
	registry: string;
	repo: string;
	entity: IndexEntry;
}

type Match = LockfileMatch | ManifestMatch | RegistryMatch;

interface FindInRegistriesResult {
	matches: RegistryMatch[];
	/**
	 * True iff at least one registry's cache loaded successfully. Distinguishes
	 * "no usable indexes" (issue #25 — caches missing or fingerprint-stale)
	 * from "indexes loaded but the entity isn't there" so the error message
	 * can point the user at the right remediation.
	 */
	anyIndexLoaded: boolean;
}

export interface InfoCommandOptions {
	json?: boolean;
	/**
	 * Project directory holding `skilltree.yml` / `skilltree.lock`. Defaults
	 * to `process.cwd()`. Tests pass an isolated tempDir so they don't pick up
	 * the surrounding project's manifest.
	 */
	dir?: string;
}

/**
 * `skilltree info <name>` — layered lookup across the three places a dep can
 * live (issue #75). Order matters and is intentional:
 *
 *   1. lockfile  (most authoritative — exact installed state)
 *   2. manifest  (declared but maybe not yet installed)
 *   3. registries (catalog of available skills)
 *
 * A locally-resolvable dep must never error out because registries aren't
 * configured or their caches are stale — those concerns belong only to the
 * registry layer. Exit code is 0 if found in any layer; 1 only when truly
 * absent from all three.
 */
export async function infoCommand(
	name: string,
	opts?: InfoCommandOptions,
	configPath?: string,
	cacheDir?: string,
): Promise<void> {
	const dir = opts?.dir ?? process.cwd();

	const lockfileMatch = await findInLockfile(name, dir);
	const manifestMatch = await findInManifest(name, dir);

	const registries = await listRegistries(configPath);
	const { matches: registryMatches, anyIndexLoaded } = await findInRegistries(
		name,
		registries,
		cacheDir,
	);

	const matches: Match[] = [];
	if (lockfileMatch) matches.push(lockfileMatch);
	if (manifestMatch) matches.push(manifestMatch);
	matches.push(...registryMatches);

	if (matches.length === 0) {
		// Nothing found anywhere — pick the most actionable error.
		// Registry setup failures (no registries / stale caches) only surface
		// when the dep wasn't locally resolvable either; otherwise users got
		// sent to "add a registry" when their lockfile already had the answer.
		handleNoMatches(name, registries.length, anyIndexLoaded, opts?.json);
		return;
	}

	if (opts?.json) {
		await printJsonInfo(matches, cacheDir);
		return;
	}

	await printTextInfo(matches, name, cacheDir);
}

// --- Layer 1: lockfile ---

async function findInLockfile(name: string, dir: string): Promise<LockfileMatch | null> {
	// readLockfile returns null on ENOENT; parse errors (corruption,
	// unsupported version, cycles) propagate by design (see lockfile.ts).
	// Letting them surface here is better than silently falling through
	// to "not found in any registry" — the user needs to know.
	const lockfile = await readLockfile(dir);
	if (!lockfile) return null;

	for (const [key, entry] of Object.entries(lockfile.packages)) {
		const entryName = entry.name ?? key;
		if (entryName === name) {
			return { layer: "lockfile", name: entryName, entry };
		}
	}
	return null;
}

// --- Layer 2: manifest ---

async function findInManifest(name: string, dir: string): Promise<ManifestMatch | null> {
	// No manifest is a normal state for `info` (e.g., user runs it outside
	// a project root). Check existence explicitly so a real read/parse
	// error still surfaces — same rationale as findInLockfile.
	if (!manifestExists(dir)) return null;
	const manifest: Manifest = await readManifest(dir);
	const expanded = expandSources(manifest);

	const prod = expanded.dependencies ?? {};
	for (const [key, dep] of Object.entries(prod)) {
		if ((dep.name ?? key) === name) {
			return { layer: "manifest", name, dep, group: "prod" };
		}
	}
	const dev = expanded["dev-dependencies"] ?? {};
	for (const [key, dep] of Object.entries(dev)) {
		if ((dep.name ?? key) === name) {
			return { layer: "manifest", name, dep, group: "dev" };
		}
	}
	return null;
}

// --- Layer 3: registries ---

async function findInRegistries(
	name: string,
	registries: Array<{ name: string; repo: string }>,
	cacheDir?: string,
): Promise<FindInRegistriesResult> {
	const matches: RegistryMatch[] = [];
	let anyIndexLoaded = false;
	for (const reg of registries) {
		// loadFreshRegistryIndex skips fingerprint-incompatible caches (issue #25).
		const index = await loadFreshRegistryIndex(reg.name, cacheDir);
		if (!index) continue;
		anyIndexLoaded = true;
		for (const entity of index.entities) {
			if (entity.name === name) {
				matches.push({ layer: "registry", registry: reg.name, repo: reg.repo, entity });
			}
		}
	}
	return { matches, anyIndexLoaded };
}

// --- "nothing found" routing ---

function handleNoMatches(
	name: string,
	registryCount: number,
	anyIndexLoaded: boolean,
	json: boolean | undefined,
): void {
	// Setup failures must propagate regardless of --json (matches search.ts):
	// a scripted consumer otherwise sees `[]` and treats it as definitively
	// absent. Issue #25.
	if (registryCount > 0 && !anyIndexLoaded) {
		throw new Error("No registry indexes available. Run 'skilltree registry update' first.");
	}
	if (json) {
		console.log("[]");
		return;
	}
	if (registryCount === 0) {
		throw new Error(
			`"${name}" not found in lockfile, manifest, or any registry. No registries configured — run 'skilltree registry add <url>' to broaden the search.`,
		);
	}
	throw new Error(
		`"${name}" not found in lockfile, manifest, or any registry.\nRun 'skilltree search <query>' to find available skills.`,
	);
}

// --- Rendering: JSON ---

async function printJsonInfo(matches: Match[], cacheDir?: string): Promise<void> {
	const out = await Promise.all(matches.map((m) => matchToJson(m, cacheDir)));
	console.log(JSON.stringify(out, null, 2));
}

async function matchToJson(m: Match, cacheDir?: string): Promise<Record<string, unknown>> {
	if (m.layer === "lockfile") {
		const e = m.entry;
		const result: Record<string, unknown> = {
			layer: "lockfile",
			name: m.name,
			type: e.type,
			group: e.group,
			path: e.path,
			commit: e.commit,
			dependencies: e.dependencies,
		};
		if (e.repo !== undefined) result.repo = e.repo;
		if (e.source !== undefined) result.source = e.source;
		if (e.version !== undefined) result.version = e.version;
		if (e.integrity !== undefined) result.integrity = e.integrity;
		return result;
	}
	if (m.layer === "manifest") {
		return {
			layer: "manifest",
			name: m.name,
			group: m.group,
			...depToJson(m.dep),
		};
	}
	// registry
	const result: Record<string, unknown> = {
		layer: "registry",
		registry: m.registry,
		repo: m.repo,
		...m.entity,
	};
	const versions = await fetchVersions(m.registry, cacheDir);
	if (versions.length > 0) {
		result.versions = versions;
		result.latest = versions[0];
	}
	return result;
}

function depToJson(dep: Dependency): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (isRemoteDependency(dep)) {
		out.repo = dep.repo;
		if (dep.path !== undefined) out.path = dep.path;
		if (dep.version !== undefined) out.version = dep.version;
		if (dep.type !== undefined) out.type = dep.type;
		return out;
	}
	if (isSourceDependency(dep)) {
		out.source = dep.source;
		if (dep.path !== undefined) out.path = dep.path;
		if (dep.version !== undefined) out.version = dep.version;
		if (dep.type !== undefined) out.type = dep.type;
		return out;
	}
	if (isLocalDependency(dep)) {
		out.local = dep.local;
		if (dep.type !== undefined) out.type = dep.type;
		return out;
	}
	return out;
}

// --- Rendering: text ---

async function printTextInfo(matches: Match[], name: string, cacheDir?: string): Promise<void> {
	for (let i = 0; i < matches.length; i++) {
		const m = matches[i] as Match;
		if (i > 0) console.log();
		if (m.layer === "lockfile") {
			printLockfileSection(m);
		} else if (m.layer === "manifest") {
			printManifestSection(m);
		} else {
			await printRegistrySection(m, name, cacheDir);
		}
	}
}

function printLockfileSection(m: LockfileMatch): void {
	const e = m.entry;
	console.log(`  ${pc.bold("[lockfile]")} ${pc.bold(m.name)} ${dim(`(${e.type})`)}`);
	console.log(`  ${label("Group:")}        ${e.group}`);
	const source = e.source === "local" ? "local" : (e.repo ?? "-");
	console.log(`  ${label("Source:")}       ${source}`);
	console.log(`  ${label("Path:")}         ${e.path}`);
	if (e.version) {
		console.log(`  ${label("Version:")}      ${pc.green(e.version)}`);
	}
	console.log(`  ${label("Commit:")}       ${e.commit}`);
	if (e.integrity) {
		console.log(`  ${label("Integrity:")}    ${dim(e.integrity)}`);
	}
	if (e.dependencies.length > 0) {
		console.log(`  ${label("Dependencies:")} ${e.dependencies.join(", ")}`);
	}
}

function printManifestSection(m: ManifestMatch): void {
	console.log(`  ${pc.bold("[manifest]")} ${pc.bold(m.name)} ${dim(`(${m.group})`)}`);
	const d = m.dep;
	if (isRemoteDependency(d)) {
		console.log(`  ${label("Source:")}       ${d.repo}`);
		if (d.path) console.log(`  ${label("Path:")}         ${d.path}`);
		if (d.version) console.log(`  ${label("Version:")}      ${d.version}`);
	} else if (isSourceDependency(d)) {
		console.log(`  ${label("Source:")}       ${d.source}`);
		if (d.path) console.log(`  ${label("Path:")}         ${d.path}`);
		if (d.version) console.log(`  ${label("Version:")}      ${d.version}`);
	} else if (isLocalDependency(d)) {
		console.log(`  ${label("Source:")}       local`);
		console.log(`  ${label("Path:")}         ${d.local}`);
	}
	if (d.type) console.log(`  ${label("Type:")}         ${d.type}`);
}

async function printRegistrySection(
	m: RegistryMatch,
	name: string,
	cacheDir?: string,
): Promise<void> {
	console.log(
		`  ${pc.bold(`[registry: ${m.registry}]`)} ${pc.bold(m.entity.name)} ${dim(`(${m.entity.type})`)}`,
	);
	console.log(`  ${label("Repo:")}         ${m.repo}`);
	console.log(`  ${label("Path:")}         ${m.entity.path}`);
	if (m.entity.description) {
		console.log(`  ${label("Description:")}  ${m.entity.description}`);
	}
	if (m.entity.tags?.length) {
		console.log(`  ${label("Tags:")}         ${m.entity.tags.join(", ")}`);
	}
	const versions = await fetchVersions(m.registry, cacheDir);
	if (versions.length > 0) {
		console.log(`  ${label("Versions:")}     ${versions.slice(0, 10).join(", ")}`);
		console.log(`  ${label("Latest:")}       ${pc.green(versions[0] ?? "")}`);
	}
	console.log();
	console.log(`  ${pc.cyan(`→ skilltree add ${name} --repo ${m.repo} --path ${m.entity.path}`)}`);
}

async function fetchVersions(registry: string, cacheDir?: string): Promise<string[]> {
	try {
		const repoDir = getRegistryRepoDir(registry, cacheDir);
		const tags = await listTags(repoDir);
		return tags
			.map((t) => t.replace(/^v/, ""))
			.filter((t) => semver.valid(t) !== null)
			.sort((a, b) => semver.rcompare(a, b));
	} catch {
		return [];
	}
}
