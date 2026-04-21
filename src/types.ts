export type EntityType = "skill" | "agent";
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
	/** Internal: the source directory this dep came from (for same-origin resolution). Not serialized. */
	_sourceDir?: string;
}

export type Dependency = RemoteDependency | SourceDependency | LocalDependency;

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
