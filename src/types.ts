export type EntityType = "skill" | "agent" | "command";
export type DependencyGroup = "prod" | "dev";

export interface RemoteDependency {
	repo: string;
	path?: string;
	version?: string;
	type?: EntityType;
	name?: string;
	/** Silence origin-manifest path warnings (R10). */
	force_path?: boolean;
}

export interface SourceDependency {
	source: string;
	path?: string;
	version?: string;
	type?: EntityType;
	name?: string;
	/** Silence origin-manifest path warnings (R10). */
	force_path?: boolean;
}

export interface LocalDependency {
	local: string;
	type?: EntityType;
	name?: string;
	/**
	 * Publication-surface flag. When `false`, this entity is invisible to every
	 * consumer-facing path (registry indexing, vendor, origin-manifest lookup)
	 * but still installs into the maintainer's own .claude/. Default: `true`.
	 * Only valid on local entries. See docs/specs/publication_surface.md §PS3.
	 */
	publish?: boolean;
	/**
	 * File-level trim for published entities. Gitignore-style globs, relative
	 * to the entity root. Honored by installer (copy) and vendor.
	 * Only valid on local entries. See docs/specs/publication_surface.md §PS6.
	 */
	exclude?: string[];
	/** Internal: the source directory this dep came from (for same-origin resolution). Not serialized. */
	_sourceDir?: string;
}

/**
 * Reference to a named pack — a group of dependencies defined in some
 * `skilltree.yml`'s `packs:` section. The resolver expands a `PackDependency`
 * into N synthesized direct deps and then proceeds with normal resolution.
 * A pack is never an entity itself: no path, no type, no install, no lockfile
 * entry. See `docs/specs/packs.md`.
 */
export interface PackDependency {
	pack: string;
	/** Remote pack — repo containing the `packs:` section. */
	repo?: string;
	/** Remote pack via source alias (expanded to `repo` by `expandSources`). */
	source?: string;
	/** Semver constraint on the containing repo's git tag. Requires repo/source. */
	version?: string;
}

export type Dependency = RemoteDependency | SourceDependency | LocalDependency | PackDependency;

/**
 * Members of a `packs:` entry. In v1 a member is a normal entity dependency;
 * the structural union permits a future `PackDependency` for nested packs but
 * the parser rejects that shape today (see `parsePackMember`).
 */
export type PackMember = RemoteDependency | SourceDependency | LocalDependency;

/** Top-level `packs:` mapping: name → non-empty member list. */
export type PacksSection = Record<string, PackMember[]>;

/**
 * Configuration for `skilltree scan`. Authoring-only — never consulted in the
 * install path. See `docs/specs/reference.md` for full semantics. Issue #52.
 */
export interface ScanConfig {
	/**
	 * Additional names the scanner should treat as already-known (in addition
	 * to the hardcoded `BUILTIN_HARNESS_COMMANDS` set). Exact match, no prefix
	 * matching — `loop` does not match `loop-runner`. Use for internal slash
	 * commands or skills that intentionally aren't declared as dependencies.
	 */
	ignore?: string[];
}

export interface Manifest {
	name?: string;
	install_path?: string; // Legacy — maps to dev_install_path
	dev_install_path?: string; // Deprecated — use install_targets instead
	install_targets?: string[]; // Agent names or literal paths (e.g., ["claude", "./custom"])
	src_install_path?: string; // Where application runtime skills go (optional)
	vendor?: boolean; // Vendor mode: all deps copied (no symlinks), committed to git
	/**
	 * Records which `install_targets` entry was used the last time
	 * `skilltree vendor` ran, so `skilltree unvendor` can clean up the right
	 * directory without re-asking the user. Issue #89.
	 *
	 * Set by `vendor --target <X>` (or `vendor` on a single-target manifest)
	 * and cleared by `unvendor`. Legacy manifests with `dev_install_path` do
	 * not record this — there are no named targets to record.
	 */
	vendored_target?: string;
	sources?: Record<string, string>;
	dependencies?: Record<string, Dependency>;
	"dev-dependencies"?: Record<string, Dependency>;
	packs?: PacksSection; // Named groups of dependencies (Oxygen). See docs/specs/packs.md.
	scan?: ScanConfig; // Authoring-aid config; never used at install time. Issue #52.
}

export interface LockfileEntry {
	type: EntityType;
	group: DependencyGroup;
	repo?: string;
	source?: string;
	path: string;
	version?: string;
	commit: string;
	integrity?: string;
	name?: string;
	dependencies: string[];
}

export interface Lockfile {
	lockfile_version: number;
	install_targets?: string[];
	packages: Record<string, LockfileEntry>;
}

export interface SkillFrontmatter {
	name?: string;
	description?: string;
	dependencies?: string[]; // SKILL.md: `dependencies: [a, b]`
	skills?: string[]; // Agent .md: `skills:` field (comma-separated or array)
}

// --- Registry types ---

/** Entry in ~/.skilltree/config.yaml */
export interface RegistryEntry {
	name: string;
	repo: string;
}

/** The full global config file */
export interface RegistryConfig {
	registries: RegistryEntry[];
}

/** A single entity in the search index */
export interface IndexEntry {
	name: string;
	type: EntityType;
	path: string;
	description?: string;
	tags?: string[];
	/**
	 * Distinguishes a pack-discoverable index entry from a normal entity entry.
	 * - "entity" (default, omitted in YAML): a skill/agent/command.
	 * - "pack": maps to a `packs:` definition in the registry repo's manifest.
	 * `add` reads this to decide between building a `RemoteDependency` and a
	 * `PackDependency`. Oxygen Phase 3.
	 */
	kind?: "entity" | "pack";
}

/** The cached index.json per registry */
export interface RegistryIndex {
	registry: string;
	repo: string;
	updated_at: string; // ISO 8601
	/**
	 * Bumped whenever `scanRegistry` semantics change in a way that makes
	 * older cached indexes wrong (not just out-of-date). See
	 * `SCANNER_VERSION` in `core/registry-cache.ts`.
	 */
	scanner_version?: number;
	/** Running skilltree version that produced this cache (diagnostic). */
	package_version?: string;
	entities: IndexEntry[];
}

// --- Doctor / check result types ---

/**
 * Status of one health check run by `skilltree doctor` (Nitrogen, issue #84).
 * - `pass`: the check ran and found nothing wrong.
 * - `fail`: the check ran and found a blocking issue. Exits 1.
 * - `warn`: the check ran and found a non-blocking issue (e.g., auth-required
 *   registry skipped). Does not affect exit code.
 * - `skip`: the check did not run (e.g., project-scoped check under `--global`).
 */
export type CheckStatus = "pass" | "fail" | "warn" | "skip";

/**
 * Result row emitted by one doctor check. `name` is a stable kebab-case
 * identifier; `detail` and `fix` are user-facing strings, optional when absent.
 * See docs/specs/doctor.md §D16–D19.
 */
export interface CheckResult {
	name: string;
	status: CheckStatus;
	detail?: string;
	fix?: string;
}

/**
 * Output of `collectCheckIssues` — the pure data form of `skilltree check`.
 * `lint` and `frontmatterWarnings` are warning-class strings (count toward
 * doctor's lint `fail`/`warn`); `frontmatterNotes` are dim notes that never
 * gate.
 */
export interface CheckSummary {
	lint: string[];
	frontmatterWarnings: string[];
	frontmatterNotes: string[];
}

// --- Type guards ---

/**
 * A `PackDependency` may carry `repo` or `source`, so the entity-dep guards
 * must explicitly exclude it. Without this, a pack reference would be treated
 * as a remote/source entity dep and processed by the normal resolution path.
 */
export function isRemoteDependency(dep: Dependency): dep is RemoteDependency {
	return "repo" in dep && !("pack" in dep);
}

export function isSourceDependency(dep: Dependency): dep is SourceDependency {
	return "source" in dep && !("pack" in dep);
}

export function isLocalDependency(dep: Dependency): dep is LocalDependency {
	return "local" in dep;
}

export function isPackDependency(dep: Dependency): dep is PackDependency {
	return "pack" in dep;
}
