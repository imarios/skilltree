import { existsSync } from "node:fs";
import pc from "picocolors";
import { getGlobalDir } from "./paths.js";

export const MANIFEST_NEW = "skilltree.yaml";
export const MANIFEST_NEW_ALT = "skilltree.yml";
export const MANIFEST_LEGACY = "skillkit.yaml";
export const LOCKFILE_NEW = "skilltree.lock";
export const LOCKFILE_LEGACY = "skillkit.lock";
export const GLOBAL_MANIFEST = "global.yaml";
export const GLOBAL_MANIFEST_ALT = "global.yml";
export const GLOBAL_LOCKFILE = "global.lock";

const DEPRECATION_PREFIX = pc.yellow("[DEPRECATION]");

let manifestWarned = false;
let lockfileWarned = false;

/**
 * Resolve the manifest filename in a directory.
 * Accepts skilltree.yaml or skilltree.yml; refuses if both exist.
 * Falls back to skillkit.yaml with a deprecation warning.
 */
export function resolveManifestPath(dir: string): { path: string; filename: string } {
	const newPath = `${dir}/${MANIFEST_NEW}`;
	const altPath = `${dir}/${MANIFEST_NEW_ALT}`;
	const newExists = existsSync(newPath);
	const altExists = existsSync(altPath);

	if (newExists && altExists) {
		throw new Error(
			`Both ${MANIFEST_NEW} and ${MANIFEST_NEW_ALT} exist in ${dir}. Keep only one — they're the same format under different extensions.`,
		);
	}
	if (newExists) {
		return { path: newPath, filename: MANIFEST_NEW };
	}
	if (altExists) {
		return { path: altPath, filename: MANIFEST_NEW_ALT };
	}

	const legacyPath = `${dir}/${MANIFEST_LEGACY}`;
	if (existsSync(legacyPath)) {
		if (!manifestWarned) {
			console.warn(
				`${DEPRECATION_PREFIX} Found ${MANIFEST_LEGACY} — please rename to ${MANIFEST_NEW}. Support for ${MANIFEST_LEGACY} will be removed in a future version.`,
			);
			manifestWarned = true;
		}
		return { path: legacyPath, filename: MANIFEST_LEGACY };
	}

	// Neither exists — return the new name (caller decides whether to error or create)
	return { path: newPath, filename: MANIFEST_NEW };
}

/**
 * Resolve the lockfile filename in a directory.
 * Prefers skilltree.lock, falls back to skillkit.lock with a deprecation warning.
 */
export function resolveLockfilePath(dir: string): { path: string; filename: string } {
	const newPath = `${dir}/${LOCKFILE_NEW}`;
	if (existsSync(newPath)) {
		return { path: newPath, filename: LOCKFILE_NEW };
	}

	const legacyPath = `${dir}/${LOCKFILE_LEGACY}`;
	if (existsSync(legacyPath)) {
		if (!lockfileWarned) {
			console.warn(
				`${DEPRECATION_PREFIX} Found ${LOCKFILE_LEGACY} — please rename to ${LOCKFILE_NEW}. Support for ${LOCKFILE_LEGACY} will be removed in a future version.`,
			);
			lockfileWarned = true;
		}
		return { path: legacyPath, filename: LOCKFILE_LEGACY };
	}

	// Neither exists — return the new name
	return { path: newPath, filename: LOCKFILE_NEW };
}

/**
 * Check if a manifest exists (skilltree.yaml, skilltree.yml, or legacy skillkit.yaml).
 */
export function manifestExists(dir: string): boolean {
	return (
		existsSync(`${dir}/${MANIFEST_NEW}`) ||
		existsSync(`${dir}/${MANIFEST_NEW_ALT}`) ||
		existsSync(`${dir}/${MANIFEST_LEGACY}`)
	);
}

/**
 * The display name for the manifest file (used in user-facing messages).
 * Shows the new name, since that's what we want users to adopt.
 */
export const MANIFEST_DISPLAY = MANIFEST_NEW;
export const LOCKFILE_DISPLAY = LOCKFILE_NEW;

// --- Global paths ---

/**
 * Resolve the global manifest path: ~/.skilltree/global.yaml (or .yml).
 * Refuses if both extensions are present.
 */
export function resolveGlobalManifestPath(globalDir?: string): {
	path: string;
	filename: string;
} {
	const dir = globalDir ?? getGlobalDir();
	const yamlPath = `${dir}/${GLOBAL_MANIFEST}`;
	const ymlPath = `${dir}/${GLOBAL_MANIFEST_ALT}`;
	const yamlExists = existsSync(yamlPath);
	const ymlExists = existsSync(ymlPath);

	if (yamlExists && ymlExists) {
		throw new Error(
			`Both ${GLOBAL_MANIFEST} and ${GLOBAL_MANIFEST_ALT} exist in ${dir}. Keep only one — they're the same format under different extensions.`,
		);
	}
	if (ymlExists && !yamlExists) {
		return { path: ymlPath, filename: GLOBAL_MANIFEST_ALT };
	}
	return { path: yamlPath, filename: GLOBAL_MANIFEST };
}

/**
 * Resolve the global lockfile path: ~/.skilltree/global.lock
 */
export function resolveGlobalLockfilePath(globalDir?: string): {
	path: string;
	filename: string;
} {
	const dir = globalDir ?? getGlobalDir();
	return { path: `${dir}/${GLOBAL_LOCKFILE}`, filename: GLOBAL_LOCKFILE };
}

/**
 * Check if a global manifest exists (.yaml or .yml).
 */
export function globalManifestExists(globalDir?: string): boolean {
	const dir = globalDir ?? getGlobalDir();
	return existsSync(`${dir}/${GLOBAL_MANIFEST}`) || existsSync(`${dir}/${GLOBAL_MANIFEST_ALT}`);
}
