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

export type Dependency = RemoteDependency | SourceDependency | LocalDependency;

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
	sources?: Record<string, string>;
	dependencies?: Record<string, Dependency>;
	"dev-dependencies"?: Record<string, Dependency>;
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

// --- Type guards ---

export function isRemoteDependency(dep: Dependency): dep is RemoteDependency {
	return "repo" in dep;
}

export function isSourceDependency(dep: Dependency): dep is SourceDependency {
	return "source" in dep;
}

export function isLocalDependency(dep: Dependency): dep is LocalDependency {
	return "local" in dep;
}
