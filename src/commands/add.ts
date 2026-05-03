import { stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import semver from "semver";
import { canonicalSource } from "../core/deps.js";
import { MANIFEST_NEW } from "../core/filenames.js";
import { loadManifestOrThrow, writeGlobalManifest, writeManifest } from "../core/manifest.js";
import { collapseTilde, expandTilde, getGlobalDir } from "../core/paths.js";
import { loadFreshRegistryIndex } from "../core/registry-cache.js";
import { assertKnownRegistry, listRegistries } from "../core/registry-config.js";
import { dim, pc, success, warn } from "../core/ui.js";
import type {
	Dependency,
	EntityType,
	IndexEntry,
	LocalDependency,
	RemoteDependency,
	SourceDependency,
} from "../types.js";

export interface AddOptions {
	repo?: string;
	source?: string;
	path?: string;
	version?: string;
	local?: string;
	dev?: boolean;
	type?: EntityType;
	registry?: string;
	global?: boolean;
	/** Skip the glob-mode confirmation prompt. */
	yes?: boolean;
	// Test overrides (avoid touching real ~/.skilltree/)
	configPath?: string;
	cacheDir?: string;
	globalDir?: string;
	/** Test hook: canned answer for the glob confirmation prompt. */
	askFn?: (question: string) => Promise<string>;
	/** Test hook: override TTY detection. Defaults to process.stdout.isTTY. */
	isInteractive?: boolean;
}

export async function addCommand(name: string, opts: AddOptions, dir: string): Promise<void> {
	if (isGlobPattern(name)) {
		await addGlobCommand(name, opts, dir);
		return;
	}
	validateAddFlags(opts);
	const dep = await buildDependency(name, opts, dir);

	const globalDir = opts.globalDir ?? getGlobalDir();
	const manifest = await loadManifestOrThrow(dir, { global: opts.global, globalDir });

	const group = opts.dev ? "dev-dependencies" : "dependencies";
	const deps = manifest[group] ?? {};

	checkOverwrite(name, deps, group, dep, manifest.sources);
	checkOtherGroup(name, manifest, opts);

	// Preserve user-authored metadata the CLI doesn't know about. These
	// fields are orthogonal to the source/path identity — CLI opts never
	// touch them, so re-adding the same entry shouldn't silently drop them.
	// Mutex fields (repo/source/local) and identity fields (repo/source/local/path)
	// are NOT in this list — CLI wins for those.
	preserveOrthogonalFields(dep, deps[name]);

	deps[name] = dep;
	manifest[group] = deps;

	if (opts.global) {
		await writeGlobalManifest(manifest, globalDir);
	} else {
		await writeManifest(dir, manifest);
	}
	success(`Added ${name} to ${group}${opts.global ? " (global)" : ""}`);
	const installCmd = opts.global ? "skilltree install --global" : "skilltree install";
	console.log(dim(`  Run \`${installCmd}\` to install.`));
}

/** A literal `*` or `?` in a name signals user-intent glob expansion (Issue #14). */
function isGlobPattern(name: string): boolean {
	return /[*?]/.test(name);
}

/**
 * Convert a glob pattern (`*`, `?`) into an anchored regex. All other
 * characters are regex-escaped so user input like `kibana-*` matches
 * literally everywhere except at the wildcards.
 */
function globToRegex(pattern: string): RegExp {
	let re = "";
	for (const ch of pattern) {
		if (ch === "*") re += ".*";
		else if (ch === "?") re += ".";
		else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${re}$`);
}

/**
 * Glob mode is registry-only — `--repo`/`--source`/`--local`/`--path` are
 * single-source flags whose semantics don't generalize across many matches.
 * Two-phase commit: build a preview of every match (with cross-registry
 * collisions surfaced), confirm with the user, then write the manifest in
 * one batched read/write.
 */
async function addGlobCommand(pattern: string, opts: AddOptions, dir: string): Promise<void> {
	if (opts.repo || opts.source || opts.local || opts.path) {
		throw new Error(
			`Glob patterns (e.g. "${pattern}") are only supported for registry-resolved adds. ` +
				`Drop --repo/--source/--local/--path to expand from registries, or use --registry <name> to scope expansion to one registry.`,
		);
	}
	validateAddFlags(opts);

	const re = globToRegex(pattern);
	const all = await loadRegistryEntities(opts);
	// `--type` filters expansion (Issue #22). Without it, `add 'hyp-*' --type
	// command` would still pull in matching skills/agents — surprising and
	// inconsistent with single-name resolution.
	const matched = all.filter(
		(m) => re.test(m.entity.name) && (!opts.type || m.entity.type === opts.type),
	);
	const items = buildGlobPreview(matched);

	if (items.length === 0) {
		const typeHint = opts.type ? ` of type '${opts.type}'` : "";
		throw new Error(
			`Glob "${pattern}": no entries${typeHint} matched in any registry. Run 'skilltree search ${pattern.replace(/[*?]/g, "")}' to see available names.`,
		);
	}

	const group = opts.dev ? "dev-dependencies" : "dependencies";
	printGlobPreview(pattern, items, group, opts.global);
	if (!(await confirmGlobAdd(items.length, opts))) {
		console.log(dim("Aborted."));
		return;
	}

	const globalDir = opts.globalDir ?? getGlobalDir();
	const manifest = await loadManifestOrThrow(dir, { global: opts.global, globalDir });
	const deps = manifest[group] ?? {};

	for (const item of items) {
		const m = item.picked;
		const dep: Dependency = { repo: m.repo, path: m.entity.path, version: opts.version ?? "*" };
		if (opts.type) dep.type = opts.type;
		checkOverwrite(m.entity.name, deps, group, dep, manifest.sources);
		checkOtherGroup(m.entity.name, manifest, opts);
		preserveOrthogonalFields(dep, deps[m.entity.name]);
		deps[m.entity.name] = dep;
	}
	manifest[group] = deps;

	if (opts.global) {
		await writeGlobalManifest(manifest, globalDir);
	} else {
		await writeManifest(dir, manifest);
	}

	success(
		`Added ${items.length} ${items.length === 1 ? "entry" : "entries"} to ${group}${opts.global ? " (global)" : ""}: ${items.map((i) => i.picked.entity.name).join(", ")}`,
	);
	const installCmd = opts.global ? "skilltree install --global" : "skilltree install";
	console.log(dim(`  Run \`${installCmd}\` to install.`));
}

/**
 * One row of the glob preview: the name, the registry/repo/path that will
 * actually be written (`picked`), and any other registries that also
 * publish this name (`alternates`). The first match in registry order
 * wins — alternates are reported so the user can override with --registry.
 */
interface GlobPreviewItem {
	picked: RegistryEntity;
	alternates: RegistryEntity[];
}

function buildGlobPreview(matches: RegistryEntity[]): GlobPreviewItem[] {
	const byName = new Map<string, RegistryEntity[]>();
	for (const m of matches) {
		const list = byName.get(m.entity.name);
		if (list) list.push(m);
		else byName.set(m.entity.name, [m]);
	}
	const items: GlobPreviewItem[] = [];
	for (const group of byName.values()) {
		const [picked, ...alternates] = group;
		if (picked) items.push({ picked, alternates });
	}
	items.sort((a, b) => a.picked.entity.name.localeCompare(b.picked.entity.name));
	return items;
}

function printGlobPreview(
	pattern: string,
	items: GlobPreviewItem[],
	group: string,
	isGlobal: boolean | undefined,
): void {
	const target = `${group}${isGlobal ? " (global)" : ""}`;
	console.log(
		`\nGlob "${pc.bold(pattern)}" matched ${pc.bold(String(items.length))} ${items.length === 1 ? "entry" : "entries"} for ${target}:\n`,
	);
	const nameW = Math.max(...items.map((i) => i.picked.entity.name.length));
	const regW = Math.max(...items.map((i) => i.picked.registry.length));
	for (const item of items) {
		const m = item.picked;
		console.log(
			`  ${pc.bold(m.entity.name.padEnd(nameW))}  ${dim(m.registry.padEnd(regW))}  ${dim(`${m.repo}/${m.entity.path}`)}`,
		);
	}
	const collisions = items.filter((i) => i.alternates.length > 0);
	if (collisions.length > 0) {
		console.log();
		for (const item of collisions) {
			const others = item.alternates.map((a) => a.registry).join(", ");
			warn(
				`"${item.picked.entity.name}" also in ${others} — picking ${item.picked.registry} (first registry). Use --registry to override.`,
			);
		}
	}
	console.log();
}

/**
 * Decide whether to proceed. Resolution order mirrors `init.ts`:
 *  1. `--yes` → proceed without prompting.
 *  2. `askFn` (test hook) → ask via that function.
 *  3. TTY (or `isInteractive: true` override) → prompt via readline.
 *  4. Non-TTY (CI/tests) → CI-safe default: proceed.
 */
async function confirmGlobAdd(count: number, opts: AddOptions): Promise<boolean> {
	if (opts.yes) return true;
	const interactive = opts.isInteractive ?? Boolean(process.stdout.isTTY);
	const ask = opts.askFn ?? (interactive ? readlineAsk : null);
	if (!ask) return true;
	const noun = count === 1 ? "this entry" : `these ${count} entries`;
	const answer = (await ask(`Add ${noun}? [Y/n] `)).trim().toLowerCase();
	return answer === "" || answer === "y" || answer === "yes";
}

async function readlineAsk(question: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await rl.question(question);
	} finally {
		rl.close();
	}
}

interface RegistryEntity {
	entity: IndexEntry;
	registry: string;
	repo: string;
}

/**
 * Load every entity across all (or `--registry`-filtered) registries. Throws
 * if no registries are configured or no indexes are available so callers
 * can rely on the result being non-empty by registry, not by match. Reads
 * indexes in parallel — they live in distinct cache files.
 */
async function loadRegistryEntities(opts: AddOptions): Promise<RegistryEntity[]> {
	const registries = await listRegistries(opts.configPath);
	// Validate the registry name before the empty-list check so a typo'd
	// --registry surfaces as "registry 'X' not found" (which itself reports
	// the empty-list case in its own wording) rather than the generic
	// "no registries configured" — the typo'd flag is the more precise
	// signal of what went wrong.
	assertKnownRegistry(opts.registry, registries);
	if (registries.length === 0) {
		throw new Error(
			`No location specified and no registries configured.\nEither specify --repo and --path, or run 'skilltree registry add <url>' first.`,
		);
	}
	const targets = opts.registry ? registries.filter((r) => r.name === opts.registry) : registries;
	const loaded = await Promise.all(
		// loadFreshRegistryIndex skips fingerprint-incompatible caches (issue #25),
		// so a stale index can't surface entities that no longer match reality.
		targets.map(async (reg) => ({
			reg,
			index: await loadFreshRegistryIndex(reg.name, opts.cacheDir),
		})),
	);

	const entities: RegistryEntity[] = [];
	let anyIndexLoaded = false;
	for (const { reg, index } of loaded) {
		if (!index) continue;
		anyIndexLoaded = true;
		for (const entity of index.entities) {
			entities.push({ entity, registry: reg.name, repo: reg.repo });
		}
	}
	if (!anyIndexLoaded) {
		throw new Error("No registry indexes available. Run 'skilltree registry update' first.");
	}
	return entities;
}

function validateAddFlags(opts: AddOptions): void {
	if (opts.repo && opts.source) {
		throw new Error("--repo and --source are mutually exclusive");
	}
	if (opts.global && opts.dev) {
		throw new Error(
			"--global and --dev are mutually exclusive. Global manifest has no dev-dependencies.",
		);
	}
	if ((opts.repo || opts.source) && opts.local) {
		throw new Error("--repo/--source and --local are mutually exclusive");
	}
	if (opts.local && opts.path) {
		throw new Error(
			"--local and --path are incompatible. --local takes the full path to the skill.",
		);
	}
	if (opts.version && opts.version !== "*" && !semver.validRange(opts.version)) {
		throw new Error(
			`Invalid version constraint: "${opts.version}". Use semver format (e.g., "^2.0.0", ">=1.0", "*").`,
		);
	}
}

async function buildDependency(name: string, opts: AddOptions, dir: string): Promise<Dependency> {
	const isRemote = opts.repo || opts.source;

	if (!isRemote && !opts.local) {
		return resolveFromRegistries(name, opts);
	}

	if (opts.local) {
		return buildLocalDep(opts, dir);
	}

	// R13: `--path` is optional when `--repo` or `--source` is given. The
	// resolver infers the path at install time from origin's skilltree.yml
	// or the conventional probe. If neither works, install emits a clear R9
	// error. We deliberately do not pre-resolve at add-time to keep `add`
	// network-free and fast.
	if (opts.source) {
		const dep: Dependency = { source: opts.source, version: opts.version ?? "*" };
		if (opts.path) dep.path = opts.path;
		if (opts.type) dep.type = opts.type;
		return dep;
	}

	if (opts.repo) {
		const dep: Dependency = { repo: opts.repo, version: opts.version ?? "*" };
		if (opts.path) dep.path = opts.path;
		if (opts.type) dep.type = opts.type;
		return dep;
	}

	throw new Error("Remote dependencies require --repo or --source");
}

async function buildLocalDep(opts: AddOptions, dir: string): Promise<Dependency> {
	const expandedPath = expandTilde(opts.local as string);
	const localPath = expandedPath.startsWith("/") ? expandedPath : `${dir}/${expandedPath}`;
	try {
		await stat(localPath);
	} catch {
		throw new Error(`Local path does not exist: ${opts.local}`);
	}
	const storedPath = opts.global ? collapseTilde(opts.local as string) : (opts.local as string);
	const dep: Dependency = { local: storedPath };
	if (opts.type) dep.type = opts.type;
	return dep;
}

function checkOverwrite(
	name: string,
	deps: Record<string, Dependency>,
	group: string,
	dep: Dependency,
	sources?: Record<string, string>,
): void {
	if (!(name in deps)) return;
	const oldDep = deps[name];
	const oldSource = canonicalSource(oldDep, sources);
	const newSource = canonicalSource(dep, sources);
	if (oldSource !== newSource) {
		warn(`overwriting "${name}" — changing source from ${oldSource} to ${newSource}`);
	} else {
		warn(`overwriting existing entry "${name}" in ${group}`);
	}
}

/**
 * Union of all field names defined across any Dependency variant. Used to
 * constrain PRESERVED_FIELDS at compile time so a typo (or a field that
 * doesn't exist on any dep shape) fails TypeScript instead of silently
 * writing a bogus property.
 */
type AnyDepField = keyof RemoteDependency | keyof SourceDependency | keyof LocalDependency;

/**
 * Fields that belong to the user, not the CLI. When a user re-adds an
 * existing entry, these survive the overwrite unless the CLI has an
 * opinion. Mutex / identity fields (repo, source, local, path, version)
 * are NOT preserved — CLI intent wins for those.
 *
 * `name` is preserved because it's orthogonal YAML-key aliasing that no
 * CLI flag sets. Users who want to remove an alias hand-edit YAML —
 * the common case (re-add to bump version or path) must not silently
 * drop their alias mapping.
 */
const PRESERVED_FIELDS = ["force_path", "name"] as const satisfies readonly AnyDepField[];

/**
 * Copy orthogonal user-authored metadata from the existing entry into the
 * new dep, unless the new dep has already set that field. Implements the
 * preserve-mode-on-overwrite convention (see CLAUDE.md §Code conventions).
 */
function preserveOrthogonalFields(newDep: Dependency, existing: Dependency | undefined): void {
	if (!existing || typeof existing !== "object") return;
	const target = newDep as unknown as Record<string, unknown>;
	const source = existing as unknown as Record<string, unknown>;
	for (const field of PRESERVED_FIELDS) {
		if (!(field in target) && source[field] !== undefined) {
			target[field] = source[field];
		}
	}
}

function checkOtherGroup(
	name: string,
	manifest: {
		dependencies?: Record<string, Dependency>;
		"dev-dependencies"?: Record<string, Dependency>;
	},
	opts: AddOptions,
): void {
	if (opts.global) return;
	const otherGroup = opts.dev ? "dependencies" : "dev-dependencies";
	const otherDeps = manifest[otherGroup] ?? {};
	if (name in otherDeps) {
		throw new Error(
			`"${name}" already exists in ${otherGroup}. Remove it first, or edit ${MANIFEST_NEW} directly.`,
		);
	}
}

/**
 * Resolve a skill/agent name from registered registries.
 *
 * Note: when `--registry` is set we still load all registries so we can give
 * the "found in: X, Y" hint when the name is missing from the requested
 * registry but present elsewhere. The cross-registry name check is the
 * reason this can't simply pre-filter via `loadRegistryEntities`.
 *
 * `--type` is applied as an *additional* filter on top of `--registry` (Issue
 * #22). Two same-named entries in one registry that differ only in type
 * (skill vs command) are unresolvable without it.
 */
async function resolveFromRegistries(name: string, opts: AddOptions): Promise<Dependency> {
	// Validate --registry separately because we strip it below to load all
	// registries (so the "found in: X, Y" hint can surface name matches in
	// other registries). Without this, a typo'd --registry would fall through
	// to "not found in any registry" and never name the bad flag.
	assertKnownRegistry(opts.registry, await listRegistries(opts.configPath));
	const allEntities = await loadRegistryEntities({ ...opts, registry: undefined });
	const nameMatches = allEntities.filter((m) => m.entity.name === name);
	const byRegistry = opts.registry
		? nameMatches.filter((m) => m.registry === opts.registry)
		: nameMatches;
	const filtered = opts.type ? byRegistry.filter((m) => m.entity.type === opts.type) : byRegistry;

	if (filtered.length === 0) {
		// Distinguish three "no match" cases so the error names the actual
		// constraint that eliminated everything. Order matters: check
		// registry-only emptiness first so a user who typoed --registry
		// gets the existing "found in: X, Y" hint instead of a confusing
		// "no entries of type" message.
		if (opts.registry && nameMatches.length > 0 && byRegistry.length === 0) {
			throw new Error(
				`"${name}" not found in registry '${opts.registry}'. Found in: ${nameMatches.map((m) => m.registry).join(", ")}`,
			);
		}
		if (opts.type && byRegistry.length > 0) {
			const haveTypes = [...new Set(byRegistry.map((m) => m.entity.type))].sort().join(", ");
			throw new Error(
				`"${name}" exists but no entries of type '${opts.type}' (found types: ${haveTypes}).`,
			);
		}
		throw new Error(
			`"${name}" not found in any registry.\nRun 'skilltree search <query>' to find available skills.`,
		);
	}

	if (filtered.length === 1) {
		const m = filtered[0] as RegistryEntity;
		console.log(`Resolved from registry '${m.registry}': ${dim(`${m.repo}/${m.entity.path}`)}`);
		const dep: Dependency = { repo: m.repo, path: m.entity.path, version: opts.version ?? "*" };
		if (opts.type) dep.type = opts.type;
		return dep;
	}

	// Multi-match: annotate each row with type so users see whether the
	// collision is across registries, across types, or both. Hint mentions
	// both flags — `--type` resolves intra-registry collisions that
	// `--registry` alone cannot.
	const listing = filtered
		.map((m, i) => `  [${i + 1}] ${m.registry} (${m.entity.type}) — ${m.repo} :: ${m.entity.path}`)
		.join("\n");

	throw new Error(
		`"${name}" found in ${filtered.length} entries:\n${listing}\n\nUse --registry <name> and/or --type <type> to disambiguate.`,
	);
}
