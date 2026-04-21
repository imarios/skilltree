import { stat } from "node:fs/promises";
import semver from "semver";
import { loadManifestOrThrow, writeGlobalManifest, writeManifest } from "../core/manifest.js";
import { collapseTilde, expandTilde, getGlobalDir, isLocalSource } from "../core/paths.js";
import { readRegistryIndex } from "../core/registry-cache.js";
import { listRegistries } from "../core/registry-config.js";
import { dim, success, warn } from "../core/ui.js";
import type { Dependency, EntityType, IndexEntry } from "../types.js";

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
	// Test overrides (avoid touching real ~/.skilltree/)
	configPath?: string;
	cacheDir?: string;
	globalDir?: string;
}

export async function addCommand(name: string, opts: AddOptions, dir: string): Promise<void> {
	validateAddFlags(opts);
	const dep = await buildDependency(name, opts, dir);

	const globalDir = opts.globalDir ?? getGlobalDir();
	const manifest = await loadManifestOrThrow(dir, { global: opts.global, globalDir });

	const group = opts.dev ? "dev-dependencies" : "dependencies";
	const deps = manifest[group] ?? {};

	checkOverwrite(name, deps, group, dep, manifest.sources);
	checkOtherGroup(name, manifest, opts);

	// Preserve `force_path` if the previous entry had it set — it's an
	// opt-out flag the user chose deliberately, not something CLI opts
	// should silently reset on re-add.
	const existing = deps[name];
	if (
		existing &&
		typeof existing === "object" &&
		"force_path" in existing &&
		(existing as { force_path?: boolean }).force_path === true
	) {
		(dep as { force_path?: boolean }).force_path = true;
	}

	deps[name] = dep;
	manifest[group] = deps;

	if (opts.global) {
		await writeGlobalManifest(manifest, globalDir);
	} else {
		await writeManifest(dir, manifest);
	}
	success(`Added ${name} to ${group}${opts.global ? " (global)" : ""}`);
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
	// resolver infers the path at install time from origin's skilltree.yaml
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
	const oldSource = describeSource(oldDep, sources);
	const newSource = describeSource(dep, sources);
	if (oldSource !== newSource) {
		warn(`overwriting "${name}" — changing source from ${oldSource} to ${newSource}`);
	} else {
		warn(`overwriting existing entry "${name}" in ${group}`);
	}
}

/**
 * Produce a canonical source identifier for warning-comparison purposes.
 * `source:` aliases resolve to their target via the sources map so that
 * `source: vibes` and `repo: github.com/.../vibes` compare equal when they
 * point to the same place. Source aliases that resolve to a local
 * filesystem path get canonicalized to `local:<joined-absolute-path>` so
 * that a bare `local:` entry and a `source:`-aliased local entry pointing
 * at the same file resolve to the same key.
 */
function describeSource(
	dep: Dependency | undefined,
	sources: Record<string, string> | undefined,
): string {
	if (!dep) return "local";
	if ("repo" in dep && dep.repo) return dep.repo;
	if ("source" in dep && dep.source) {
		const resolved = sources?.[dep.source];
		if (!resolved) return `source:${dep.source}`;
		if (isLocalSource(resolved)) {
			const base = expandTilde(resolved);
			const path = "path" in dep && typeof dep.path === "string" ? dep.path : "";
			const full = path && path !== "." ? `${base.replace(/\/$/, "")}/${path}` : base;
			return `local:${full}`;
		}
		return resolved;
	}
	if ("local" in dep && dep.local) {
		return `local:${expandTilde(dep.local)}`;
	}
	return "local";
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
			`"${name}" already exists in ${otherGroup}. Remove it first, or edit skilltree.yaml directly.`,
		);
	}
}

/**
 * Resolve a skill/agent name from registered registries.
 */
async function resolveFromRegistries(name: string, opts: AddOptions): Promise<Dependency> {
	const registries = await listRegistries(opts.configPath);

	if (registries.length === 0) {
		throw new Error(
			`No location specified and no registries configured.\nEither specify --repo and --path, or run 'skilltree registry add <url>' first.`,
		);
	}

	interface Match {
		entity: IndexEntry;
		registry: string;
		repo: string;
	}
	const matches: Match[] = [];
	let anyIndexLoaded = false;

	for (const reg of registries) {
		const index = await readRegistryIndex(reg.name, opts.cacheDir);
		if (!index) continue;
		anyIndexLoaded = true;
		for (const entity of index.entities) {
			if (entity.name === name) {
				matches.push({ entity, registry: reg.name, repo: reg.repo });
			}
		}
	}

	if (!anyIndexLoaded) {
		throw new Error("No registry indexes available. Run 'skilltree registry update' first.");
	}

	const filtered = opts.registry ? matches.filter((m) => m.registry === opts.registry) : matches;

	if (filtered.length === 0) {
		if (opts.registry && matches.length > 0) {
			throw new Error(
				`"${name}" not found in registry '${opts.registry}'. Found in: ${matches.map((m) => m.registry).join(", ")}`,
			);
		}
		throw new Error(
			`"${name}" not found in any registry.\nRun 'skilltree search <query>' to find available skills.`,
		);
	}

	if (filtered.length === 1) {
		const m = filtered[0] as Match;
		console.log(`Resolved from registry '${m.registry}': ${dim(`${m.repo}/${m.entity.path}`)}`);
		return { repo: m.repo, path: m.entity.path, version: opts.version ?? "*" };
	}

	const listing = filtered
		.map((m, i) => `  [${i + 1}] ${m.registry} — ${m.repo} :: ${m.entity.path}`)
		.join("\n");

	throw new Error(
		`"${name}" found in ${filtered.length} registries:\n${listing}\n\nUse --registry <name> to specify which one.`,
	);
}
