import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import YAML from "yaml";
import type { Dependency, EntityType, LocalDependency, Manifest } from "../types.js";
import { isSourceDependency } from "../types.js";
import { resolveTarget } from "./agents.js";
import { resolveGlobalManifestPath, resolveManifestPath } from "./filenames.js";
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
		manifest.sources = raw.sources as Record<string, string>;
	}

	if (raw.dependencies && typeof raw.dependencies === "object") {
		manifest.dependencies = raw.dependencies as Record<string, Dependency>;
	}

	if (raw["dev-dependencies"] && typeof raw["dev-dependencies"] === "object") {
		manifest["dev-dependencies"] = raw["dev-dependencies"] as Record<string, Dependency>;
	}

	return manifest;
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
 * - If only `dev_install_path` is set, return it as a single-element array (with deprecation warning)
 * - If neither is set, default to [".claude"]
 */
export function getInstallTargets(manifest: Manifest): string[] {
	if (manifest.install_targets) {
		return manifest.install_targets.map(resolveTarget);
	}
	if (manifest.dev_install_path || manifest.install_path) {
		warn(
			"dev_install_path is deprecated — use install_targets instead. Run: skilltree targets migrate",
		);
	}
	return [getDevInstallPath(manifest)];
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
	dep: { source: string; path: string; version?: string; type?: string; name?: string },
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

			if (hasRepo && !("path" in dep)) {
				errors.push(`${group}.${key}: remote dependencies require a "path" field`);
			}
		}
	}

	validateDeps(manifest.dependencies, "dependencies");
	validateDeps(manifest["dev-dependencies"], "dev-dependencies");

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
				: "No skilltree.yaml found. Run `skilltree init` first.",
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
