import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import type { RegistryIndex } from "../types.js";
import { cloneOrFetchBare } from "./git.js";

const REGISTRY_CACHE_DIR = join(homedir(), ".skilltree", "registry-cache");

/** Default TTL: 24 hours in milliseconds */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Fingerprint stamped into every cached `index.json` so we can detect when
 * a cache was produced by a logically-incompatible scanner.
 *
 * BUMP THIS whenever `scanRegistry` (or anything it calls) changes its output
 * in a way that would make existing on-disk caches wrong — e.g. a new entity
 * type is recognized, classification rules change, or new fields become
 * material to consumers (`search`, `info`, `add`).
 *
 * Pre-#25 caches lack this field entirely, so they fail the equality check and
 * are treated as incompatible automatically.
 *
 * History:
 *   1 — initial fingerprinted version (issue #25). Implicitly covers the
 *       slash-command scanner fix from #21/#24.
 */
export const SCANNER_VERSION = 1;

export function getRegistryCacheDir(): string {
	return REGISTRY_CACHE_DIR;
}

export function getRegistryRepoDir(name: string, cacheDir?: string): string {
	return join(cacheDir ?? REGISTRY_CACHE_DIR, name, "repo");
}

export function getRegistryIndexPath(name: string, cacheDir?: string): string {
	return join(cacheDir ?? REGISTRY_CACHE_DIR, name, "index.json");
}

/**
 * Read the cached index for a registry.
 *
 * Returns null on:
 *   - file missing (ENOENT)
 *   - malformed JSON (torn write, hand-edit, encoding issue)
 *   - structural shape violation (e.g. `entities` not an array)
 *
 * All three buckets need the same remediation — `skilltree registry update` —
 * so we collapse them into a single null-return rather than throwing opaque
 * `SyntaxError` / `TypeError` at consumers (issue #25 follow-up).
 */
export async function readRegistryIndex(
	name: string,
	cacheDir?: string,
): Promise<RegistryIndex | null> {
	const indexPath = getRegistryIndexPath(name, cacheDir);
	let content: string;
	try {
		content = await readFile(indexPath, "utf-8");
	} catch (err: unknown) {
		if (err instanceof Error && "code" in err && err.code === "ENOENT") {
			return null;
		}
		throw err;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return null;
	}
	if (!isWellFormedRegistryIndex(parsed)) {
		return null;
	}
	return parsed;
}

/**
 * Shallow shape check for a parsed `index.json`. Cheap, defensive: the goal
 * is to reject obviously-corrupt caches, not to fully validate every entity.
 * If a future field becomes load-bearing, add it here.
 */
function isWellFormedRegistryIndex(value: unknown): value is RegistryIndex {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.registry === "string" &&
		typeof v.repo === "string" &&
		typeof v.updated_at === "string" &&
		Array.isArray(v.entities)
	);
}

/**
 * Write a registry index to disk. Always stamps the cache with the running
 * `SCANNER_VERSION` and `package_version` — callers don't pass these, and any
 * value already on the input is overwritten so a round-trip read→write can't
 * resurrect a stale fingerprint.
 */
export async function writeRegistryIndex(index: RegistryIndex, cacheDir?: string): Promise<void> {
	const indexPath = getRegistryIndexPath(index.registry, cacheDir);
	await mkdir(dirname(indexPath), { recursive: true });
	const stamped: RegistryIndex = {
		...index,
		scanner_version: SCANNER_VERSION,
		package_version: pkg.version,
	};
	await writeFile(indexPath, JSON.stringify(stamped, null, 2), "utf-8");
}

/**
 * Returns true iff the cache's `scanner_version` matches the running build.
 *
 * Strict equality (not `>=`) so that downgrades — e.g. a teammate ran a newer
 * skilltree and their cache claims a higher version than this build can speak
 * — are also flagged as incompatible. Both directions of skew get the same
 * "rebuild me" UX.
 */
export function isCacheCompatible(index: RegistryIndex): boolean {
	return index.scanner_version === SCANNER_VERSION;
}

/**
 * Read a registry index AND verify it was produced by a compatible scanner.
 * Returns null when the cache is missing OR fingerprint-incompatible — both
 * cases need the same remediation (`skilltree registry update`).
 *
 * Use this from any code path that consumes the index for correctness
 * (`search`, `info`, `add`). Reserve raw `readRegistryIndex` for diagnostics.
 */
export async function loadFreshRegistryIndex(
	name: string,
	cacheDir?: string,
): Promise<RegistryIndex | null> {
	const index = await readRegistryIndex(name, cacheDir);
	if (!index) return null;
	if (!isCacheCompatible(index)) return null;
	return index;
}

/**
 * Check if a registry's cached index is stale.
 *
 * "Stale" includes both axes:
 *   - missing on disk
 *   - `scanner_version` mismatch (defense in depth — same condition that
 *     `loadFreshRegistryIndex` uses to gate consumers)
 *   - `updated_at` older than `ttlMs`
 */
export async function isStale(name: string, ttlMs?: number, cacheDir?: string): Promise<boolean> {
	const index = await readRegistryIndex(name, cacheDir);
	if (!index) {
		return true;
	}
	if (!isCacheCompatible(index)) {
		return true;
	}
	const updatedAt = new Date(index.updated_at).getTime();
	const ttl = ttlMs ?? DEFAULT_TTL_MS;
	return Date.now() - updatedAt > ttl;
}

/**
 * Remove the entire cache directory for a registry.
 */
export async function cleanRegistryCache(name: string, cacheDir?: string): Promise<void> {
	const registryDir = join(cacheDir ?? REGISTRY_CACHE_DIR, name);
	await rm(registryDir, { recursive: true, force: true });
}

/**
 * Ensure a bare git repo is cloned/fetched for a registry.
 * Returns the path to the bare repo directory.
 */
export async function ensureRegistryRepo(
	name: string,
	repoUrl: string,
	cacheDir?: string,
): Promise<string> {
	const repoDir = getRegistryRepoDir(name, cacheDir);
	await cloneOrFetchBare(repoUrl, repoDir);
	return repoDir;
}
