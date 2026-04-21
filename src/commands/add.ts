import { stat } from "node:fs/promises";
import semver from "semver";
import { canonicalSource } from "../core/deps.js";
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
