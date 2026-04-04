import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RegistryIndex } from "../types.js";
import { cloneOrFetchBare } from "./git.js";

const REGISTRY_CACHE_DIR = join(homedir(), ".skilltree", "registry-cache");

/** Default TTL: 24 hours in milliseconds */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

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
 * Read the cached index for a registry. Returns null if not found.
 */
export async function readRegistryIndex(
	name: string,
	cacheDir?: string,
): Promise<RegistryIndex | null> {
	const indexPath = getRegistryIndexPath(name, cacheDir);
	try {
		const content = await readFile(indexPath, "utf-8");
		return JSON.parse(content) as RegistryIndex;
	} catch (err: unknown) {
		if (err instanceof Error && "code" in err && err.code === "ENOENT") {
			return null;
		}
		throw err;
	}
}

/**
 * Write a registry index to disk.
 */
export async function writeRegistryIndex(index: RegistryIndex, cacheDir?: string): Promise<void> {
	const indexPath = getRegistryIndexPath(index.registry, cacheDir);
	await mkdir(dirname(indexPath), { recursive: true });
	await writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

/**
 * Check if a registry's cached index is stale (older than TTL).
 * Returns true if stale or missing.
 */
export async function isStale(name: string, ttlMs?: number, cacheDir?: string): Promise<boolean> {
	const index = await readRegistryIndex(name, cacheDir);
	if (!index) {
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
