import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import YAML from "yaml";
import type { RegistryConfig, RegistryEntry } from "../types.js";

const CONFIG_DIR = join(homedir(), ".skilltree");
const CONFIG_PATH = join(CONFIG_DIR, "config.yaml");

export function getConfigDir(): string {
	return CONFIG_DIR;
}

export function getConfigPath(): string {
	return CONFIG_PATH;
}

/**
 * Read the global config. Returns empty registries array if file doesn't exist.
 */
export async function readConfig(configPath?: string): Promise<RegistryConfig> {
	const path = configPath ?? CONFIG_PATH;
	let content: string;
	try {
		content = await readFile(path, "utf-8");
	} catch (err: unknown) {
		if (err instanceof Error && "code" in err && err.code === "ENOENT") {
			return { registries: [] };
		}
		throw err;
	}
	if (!content.trim()) {
		return { registries: [] };
	}
	const raw = YAML.parse(content);
	if (!raw || typeof raw !== "object") {
		return { registries: [] };
	}
	const registries = Array.isArray(raw.registries) ? raw.registries : [];
	return { registries };
}

/**
 * Write the global config to disk. Creates parent directories if needed.
 */
export async function writeConfig(config: RegistryConfig, configPath?: string): Promise<void> {
	const path = configPath ?? CONFIG_PATH;
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, YAML.stringify(config, { lineWidth: 0 }), "utf-8");
}

/**
 * Add a registry entry. Errors if name already exists.
 */
export async function addRegistry(name: string, repo: string, configPath?: string): Promise<void> {
	const config = await readConfig(configPath);
	const existingName = config.registries.find((r) => r.name === name);
	if (existingName) {
		throw new Error(
			`Registry "${name}" already exists (${existingName.repo}). Use --name to specify a different alias.`,
		);
	}
	const existingUrl = config.registries.find((r) => r.repo === repo);
	if (existingUrl) {
		throw new Error(`Repository "${repo}" is already registered as '${existingUrl.name}'.`);
	}
	config.registries.push({ name, repo });
	await writeConfig(config, configPath);
}

/**
 * Remove a registry entry by name. Errors if not found.
 */
export async function removeRegistry(name: string, configPath?: string): Promise<void> {
	const config = await readConfig(configPath);
	const index = config.registries.findIndex((r) => r.name === name);
	if (index === -1) {
		throw new Error(`Registry "${name}" not found`);
	}
	config.registries.splice(index, 1);
	await writeConfig(config, configPath);
}

/**
 * List all registered registries.
 */
export async function listRegistries(configPath?: string): Promise<RegistryEntry[]> {
	const config = await readConfig(configPath);
	return config.registries;
}

/**
 * Throw a precise `Registry '<name>' not found` error if `name` is set and
 * doesn't match any configured registry. No-op when `name` is undefined.
 * Centralizes the validation so callers don't fall through to misleading
 * downstream errors like "No registry indexes available" (issue #42).
 */
export function assertKnownRegistry(name: string | undefined, registries: RegistryEntry[]): void {
	if (!name) return;
	if (registries.some((r) => r.name === name)) return;
	throw unknownRegistryError(name, registries);
}

/**
 * Build the error thrown by `assertKnownRegistry`. Includes the configured
 * names and a `Did you mean: <closest>?` hint when the closest configured
 * name is within Levenshtein distance ≤ 2.
 */
export function unknownRegistryError(typed: string, registries: RegistryEntry[]): Error {
	const names = registries.map((r) => r.name);
	const head =
		names.length === 0
			? `Registry '${typed}' not found. No registries are configured. Run 'skilltree registry add <url>' first.`
			: `Registry '${typed}' not found. Configured: ${names.join(", ")}.`;
	const suggestion = closestName(typed, names);
	return new Error(suggestion ? `${head}\nDid you mean: ${suggestion}?` : head);
}

/**
 * Pick the configured name closest to `typed` by Levenshtein distance.
 * Returns null if nothing is within 2 edits — beyond that, suggestions are
 * usually noise (a 5-char typo against a 6-char name is just two unrelated
 * strings). Distance 2 catches the realistic typo cases (missing/extra/swapped
 * char, single transposition) without firing on truly different names.
 */
function closestName(typed: string, names: string[]): string | null {
	let best: string | null = null;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const name of names) {
		const d = levenshtein(typed, name);
		if (d < bestDist) {
			bestDist = d;
			best = name;
		}
	}
	return bestDist <= 2 ? best : null;
}

/**
 * Iterative two-row Levenshtein distance. O(n*m) time, O(min(n,m)) space.
 * Plenty fast for registry-name lists (tens of entries, names < 50 chars).
 */
function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;
	let prev = new Array(b.length + 1);
	let curr = new Array(b.length + 1);
	for (let j = 0; j <= b.length; j++) prev[j] = j;
	for (let i = 1; i <= a.length; i++) {
		curr[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
		}
		[prev, curr] = [curr, prev];
	}
	return prev[b.length];
}
