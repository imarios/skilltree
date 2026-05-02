import { stat } from "node:fs/promises";
import semver from "semver";
import { canonicalSource } from "../core/deps.js";
import { MANIFEST_NEW } from "../core/filenames.js";
import { loadManifestOrThrow, writeGlobalManifest, writeManifest } from "../core/manifest.js";
import { collapseTilde, expandTilde, getGlobalDir } from "../core/paths.js";
import { readRegistryIndex } from "../core/registry-cache.js";
import { listRegistries } from "../core/registry-config.js";
import { dim, success, warn } from "../core/ui.js";
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
	// Test overrides (avoid touching real ~/.skilltree/)
	configPath?: string;
	cacheDir?: string;
	globalDir?: string;
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
 * We collapse the matches into a single manifest read+write rather than
 * recursing into `addCommand` per match (which would re-read+rewrite the
 * manifest N times).
 */
async function addGlobCommand(pattern: string, opts: AddOptions, dir: string): Promise<void> {
	if (opts.repo || opts.source || opts.local || opts.path) {
		throw new Error(
			`Glob patterns (e.g. "${pattern}") are only supported for registry-resolved adds. Drop --repo/--source/--local/--path to expand from registries.`,
		);
	}
	validateAddFlags(opts);

	const re = globToRegex(pattern);
	const all = await loadRegistryEntities(opts);
	const matches = dedupeByEntityName(all.filter((m) => re.test(m.entity.name)));

	if (matches.length === 0) {
		throw new Error(
			`Glob "${pattern}": no entries matched in any registry. Run 'skilltree search ${pattern.replace(/[*?]/g, "")}' to see available names.`,
		);
	}

	console.log(
		dim(
			`Glob "${pattern}" matched ${matches.length} ${matches.length === 1 ? "entry" : "entries"}: ${matches.map((m) => m.entity.name).join(", ")}`,
		),
	);

	const globalDir = opts.globalDir ?? getGlobalDir();
	const manifest = await loadManifestOrThrow(dir, { global: opts.global, globalDir });
	const group = opts.dev ? "dev-dependencies" : "dependencies";
	const deps = manifest[group] ?? {};

	for (const m of matches) {
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
		`Added ${matches.length} ${matches.length === 1 ? "entry" : "entries"} to ${group}${opts.global ? " (global)" : ""}: ${matches.map((m) => m.entity.name).join(", ")}`,
	);
	const installCmd = opts.global ? "skilltree install --global" : "skilltree install";
	console.log(dim(`  Run \`${installCmd}\` to install.`));
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
	if (registries.length === 0) {
		throw new Error(
			`No location specified and no registries configured.\nEither specify --repo and --path, or run 'skilltree registry add <url>' first.`,
		);
	}

	const targets = opts.registry ? registries.filter((r) => r.name === opts.registry) : registries;
	const loaded = await Promise.all(
		targets.map(async (reg) => ({ reg, index: await readRegistryIndex(reg.name, opts.cacheDir) })),
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

/** Keep the first occurrence of each entity name; later registries lose ties. */
function dedupeByEntityName(entities: RegistryEntity[]): RegistryEntity[] {
	const seen = new Set<string>();
	return entities.filter((m) => {
		if (seen.has(m.entity.name)) return false;
		seen.add(m.entity.name);
		return true;
	});
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
 */
async function resolveFromRegistries(name: string, opts: AddOptions): Promise<Dependency> {
	const allEntities = await loadRegistryEntities({ ...opts, registry: undefined });
	const matches = allEntities.filter((m) => m.entity.name === name);
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
		const m = filtered[0] as RegistryEntity;
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
