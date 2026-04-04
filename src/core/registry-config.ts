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
