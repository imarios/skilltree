import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import YAML from "yaml";
import type { Dependency, EntityType, LocalDependency, Manifest } from "../types.js";
import { isSourceDependency } from "../types.js";
import { resolveGlobalTarget, resolveTarget } from "./agents.js";
import { MANIFEST_NEW, resolveGlobalManifestPath, resolveManifestPath } from "./filenames.js";
import { expandTilde, isLocalSource } from "./paths.js";
import { error, warn } from "./ui.js";

export function parseManifest(content: string): Manifest {
	const raw = YAML.parse(content) as Record<string, unknown> | null;
	if (raw === null || typeof raw !== "object") {
		throw new Error("Invalid manifest: expected a YAML mapping");
	}

	const manifest: Manifest = {};

	if (typeof raw.name === "string") {
		manifest.name = raw.name;
	}

	if (typeof raw.install_path === "string") {
		manifest.install_path = raw.install_path;
	}

	if (typeof raw.dev_install_path === "string") {
		manifest.dev_install_path = raw.dev_install_path;
	}

	if (typeof raw.src_install_path === "string") {
		manifest.src_install_path = raw.src_install_path;
	}

	if (typeof raw.vendor === "boolean") {
		manifest.vendor = raw.vendor;
	}

	if (Array.isArray(raw.install_targets)) {
		manifest.install_targets = raw.install_targets as string[];
	}

	if (raw.sources && typeof raw.sources === "object") {
		manifest.sources = parseSources(raw.sources as Record<string, unknown>);
	}

	if (raw.dependencies && typeof raw.dependencies === "object") {
		manifest.dependencies = raw.dependencies as Record<string, Dependency>;
	}

	if (raw["dev-dependencies"] && typeof raw["dev-dependencies"] === "object") {
		manifest["dev-dependencies"] = raw["dev-dependencies"] as Record<string, Dependency>;
	}

	return manifest;
}

/**
 * Parse the `sources:` map. Accepts two equivalent forms per alias:
 *
 *   sources:
 *     vibes: ~/Projects/vibes              # flat string
 *     shared:                              # nested mapping (mirrors deps syntax)
 *       repo: github.com/acme/shared
 *
 * Both normalize to a flat `Record<string, string>` internally — the rest of
 * the resolver only ever sees the URL/path. Nested form must carry exactly
 * one of `local:` / `repo:`; sources cannot themselves alias another source.
 */
function parseSources(raw: Record<string, unknown>): Record<string, string> {
	const sources: Record<string, string> = {};
	for (const [alias, value] of Object.entries(raw)) {
		if (typeof value === "string") {
			sources[alias] = value;
			continue;
		}
		if (value && typeof value === "object" && !Array.isArray(value)) {
			const obj = value as Record<string, unknown>;
			const hasLocal = "local" in obj;
			const hasRepo = "repo" in obj;
			if (hasLocal && hasRepo) {
				throw new Error(
					`Invalid manifest: sources.${alias} has both "local" and "repo" — they are mutually exclusive.`,
				);
			}
			if (!hasLocal && !hasRepo) {
				throw new Error(
					`Invalid manifest: sources.${alias} must specify either "local" or "repo" (got: ${Object.keys(obj).join(", ") || "empty"}).`,
				);
			}
			const inner = hasLocal ? obj.local : obj.repo;
			if (typeof inner !== "string") {
				throw new Error(
					`Invalid manifest: sources.${alias}.${hasLocal ? "local" : "repo"} must be a string, got ${inner === null ? "null" : typeof inner}.`,
				);
			}
			sources[alias] = inner;
			continue;
		}
		throw new Error(
			`Invalid manifest: sources.${alias} must be a string (a git URL or filesystem path) or a mapping with \`local:\` or \`repo:\`, got ${value === null ? "null" : typeof value}.`,
		);
	}
	return sources;
}

export function serializeManifest(manifest: Manifest): string {
	return YAML.stringify(manifest, { lineWidth: 0 });
}

export async function readManifest(dir: string): Promise<Manifest> {
	const { path } = resolveManifestPath(dir);
	const content = await readFile(path, "utf-8");
	return parseManifest(content);
}

export async function writeManifest(dir: string, manifest: Manifest): Promise<void> {
	const { path } = resolveManifestPath(dir);
	await writeFile(path, serializeManifest(manifest), "utf-8");
}

/**
 * Resolve the effective dev install path from manifest fields.
 * Priority: dev_install_path > install_path (legacy) > ".claude" (default)
 *
 * Note: dev_install_path is deprecated in favor of install_targets.
 * Callers should prefer getInstallTargets() for new code.
 */
export function getDevInstallPath(manifest: Manifest): string {
	return manifest.dev_install_path ?? manifest.install_path ?? ".claude";
}

/**
 * Resolve install targets from manifest.
 * - If `install_targets` is set, resolve each entry via the agent registry
 * - If only `dev_install_path` is set, return it as a single-element array
 * - If neither is set, default to [".claude"]
 *
 * Note: this helper is called from multiple sites in a single command run
 * (e.g., target build + lockfile build + stale-target check), so the
 * deprecation warning lives in `warnLegacyInstallPath` instead — call that
 * once per command from the entry point.
 */
export function getInstallTargets(manifest: Manifest, opts?: { global?: boolean }): string[] {
	const resolve = opts?.global ? resolveGlobalTarget : resolveTarget;
	if (manifest.install_targets) {
		return manifest.install_targets.map(resolve);
	}
	return [getDevInstallPath(manifest)];
}

/**
 * Emit a deprecation warning when a manifest still uses legacy
 * `dev_install_path` / `install_path` instead of `install_targets`.
 * Idempotent per call — fire once at the start of a command.
 */
export function warnLegacyInstallPath(manifest: Manifest): void {
	if (manifest.install_targets) return;
	if (manifest.dev_install_path || manifest.install_path) {
		warn(
			"dev_install_path is deprecated — use install_targets instead. Run: skilltree targets migrate",
		);
	}
}

/**
 * Names of every declared dependency, prod + dev, sorted and de-duped.
 *
 * Centralized so callers don't keep open-coding `Object.keys(deps ?? {})`
 * spreads and getting subtly inconsistent results (some sort, some don't,
 * some Set-dedupe, some don't). A name shouldn't legally appear in both
 * groups, but we de-dupe anyway so callers can treat the result as a
 * stable set.
 */
export function getAllDependencyNames(manifest: Manifest): string[] {
	const prod = Object.keys(manifest.dependencies ?? {});
	const dev = Object.keys(manifest["dev-dependencies"] ?? {});
	return Array.from(new Set([...prod, ...dev])).sort();
}

/**
 * Expand source shorthands in dependencies.
 * Replaces `source: alias` with `repo: url` using the sources map.
 */
export function expandSources(manifest: Manifest): Manifest {
	const sources = manifest.sources ?? {};
	return {
		...manifest,
		dependencies: expandDeps(manifest.dependencies, sources),
		"dev-dependencies": expandDeps(manifest["dev-dependencies"], sources),
	};
}

function expandDeps(
	deps: Record<string, Dependency> | undefined,
	sources: Record<string, string>,
): Record<string, Dependency> | undefined {
	if (!deps) return undefined;

	const expanded: Record<string, Dependency> = {};
	for (const [key, dep] of Object.entries(deps)) {
		expanded[key] = isSourceDependency(dep) ? expandSourceDep(key, dep, sources) : dep;
	}
	return expanded;
}

function expandSourceDep(
	key: string,
	dep: {
		source: string;
		path?: string;
		version?: string;
		type?: string;
		name?: string;
		force_path?: boolean;
	},
	sources: Record<string, string>,
): Dependency {
	const sourceValue = sources[dep.source];
	if (!sourceValue) {
		throw new Error(
			`Unknown source alias "${dep.source}" in dependency "${key}". Available sources: ${Object.keys(sources).join(", ") || "(none)"}`,
		);
	}

	const { source: _, ...rest } = dep;

	if (isLocalSource(sourceValue)) {
		// Local-source expansion still requires a path: there's no way to infer
		// a filesystem path from origin manifests for a local-filesystem source.
		if (!dep.path) {
			throw new Error(
				`Local source "${dep.source}" requires a "path" field on dependency "${key}".`,
			);
		}
		const expandedSource = expandTilde(sourceValue);
		const localPath = dep.path === "." ? expandedSource : `${expandedSource}/${dep.path}`;
		const localDep: LocalDependency = { local: localPath, _sourceDir: expandedSource };
		if (rest.type) localDep.type = rest.type as EntityType;
		if (rest.name) localDep.name = rest.name;
		return localDep;
	}

	return { repo: sourceValue, ...rest } as Dependency;
}

/**
 * Validate a manifest for required fields and mutual exclusivity.
 * Returns a list of error messages (empty = valid).
 */
export function validateManifest(manifest: Manifest): string[] {
	const errors: string[] = [];

	function validateDeps(deps: Record<string, Dependency> | undefined, group: string): void {
		if (!deps) return;

		for (const [key, dep] of Object.entries(deps)) {
			const hasRepo = "repo" in dep || "source" in dep;
			const hasLocal = "local" in dep;

			if (!hasRepo && !hasLocal) {
				errors.push(`${group}.${key}: must have either "repo"/"source" or "local"`);
			}

			if (hasRepo && hasLocal) {
				errors.push(`${group}.${key}: "repo"/"source" and "local" are mutually exclusive`);
			}

			// `path:` is optional for remote/source deps (R9). When missing, the
			// resolver infers it from the origin repo's skilltree.yml or the
			// conventional probe. See origin_manifest_resolution.md §R9.
		}
	}

	validateDeps(manifest.dependencies, "dependencies");
	validateDeps(manifest["dev-dependencies"], "dev-dependencies");

	// Reject empty install_targets explicitly. An empty array would otherwise
	// pass through as a no-op install (loop runs zero times) — silent success
	// is worse than a clear error. Omit the field entirely to use defaults.
	if (Array.isArray(manifest.install_targets) && manifest.install_targets.length === 0) {
		errors.push("install_targets must not be empty — omit the field to use the default (.claude)");
	}

	// Check for install_targets + dev_install_path conflict
	if (manifest.install_targets && (manifest.dev_install_path || manifest.install_path)) {
		errors.push(
			"cannot use both dev_install_path and install_targets — migrate to install_targets",
		);
	}

	// Check for same key in both groups
	if (manifest.dependencies && manifest["dev-dependencies"]) {
		for (const key of Object.keys(manifest.dependencies)) {
			if (key in manifest["dev-dependencies"]) {
				errors.push(
					`"${key}" appears in both dependencies and dev-dependencies. Use one group only.`,
				);
			}
		}
	}

	return errors;
}

/**
 * Validate a global manifest. Rejects fields that don't apply to global scope.
 */
export function validateGlobalManifest(manifest: Manifest): string[] {
	const errors = validateManifest(manifest);

	if (manifest["dev-dependencies"] && Object.keys(manifest["dev-dependencies"]).length > 0) {
		errors.push("Global manifest does not support dev-dependencies. Use dependencies only.");
	}
	if (manifest.src_install_path) {
		errors.push("Global manifest does not support src_install_path.");
	}
	// Per docs/specs/global.md: legacy install-path fields are project-only.
	// Without this guard, the field is silently dropped by buildGlobalTargets.
	if (manifest.dev_install_path) {
		errors.push("Global manifest does not support dev_install_path. Use install_targets instead.");
	}
	if (manifest.install_path) {
		errors.push("Global manifest does not support install_path. Use install_targets instead.");
	}
	if (manifest.vendor) {
		errors.push("Global manifest does not support vendor mode.");
	}

	return errors;
}

/**
 * Read project or global manifest, throwing a user-friendly error on failure.
 */
export async function loadManifestOrThrow(
	dir: string,
	opts?: { global?: boolean; globalDir?: string },
): Promise<Manifest> {
	const isGlobal = opts?.global ?? false;
	try {
		return isGlobal ? await readGlobalManifest(opts?.globalDir) : await readManifest(dir);
	} catch {
		throw new Error(
			isGlobal
				? "No global manifest found. Run `skilltree init --global` first."
				: `No ${MANIFEST_NEW} found. Run \`skilltree init\` first.`,
		);
	}
}

/**
 * Validate a manifest and throw with formatted errors if invalid.
 */
export function validateManifestOrThrow(manifest: Manifest, isGlobal?: boolean): void {
	const errors = isGlobal ? validateGlobalManifest(manifest) : validateManifest(manifest);
	if (errors.length > 0) {
		error(isGlobal ? "Invalid global manifest" : "Invalid manifest");
		for (const err of errors) {
			console.error(`  ${err}`);
		}
		throw new Error(isGlobal ? "Global manifest validation failed" : "Manifest validation failed");
	}
}

// --- Global manifest read/write ---

export async function readGlobalManifest(globalDir?: string): Promise<Manifest> {
	const { path } = resolveGlobalManifestPath(globalDir);
	const content = await readFile(path, "utf-8");
	return parseManifest(content);
}

export async function writeGlobalManifest(manifest: Manifest, globalDir?: string): Promise<void> {
	const { path } = resolveGlobalManifestPath(globalDir);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, serializeManifest(manifest), "utf-8");
}
