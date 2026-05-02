import { cleanGitUrl, normalizeGitUrl } from "../core/git.js";
import {
	cleanRegistryCache,
	ensureRegistryRepo,
	readRegistryIndex,
	writeRegistryIndex,
} from "../core/registry-cache.js";
import { addRegistry, listRegistries, removeRegistry } from "../core/registry-config.js";
import { scanRegistry } from "../core/registry-scanner.js";
import { dim, pc, success, warn } from "../core/ui.js";
import type { RegistryEntry, RegistryIndex } from "../types.js";

/**
 * Curated default registries for `skilltree registry init`.
 */
export const DEFAULT_REGISTRIES: RegistryEntry[] = [
	{ name: "trailofbits", repo: "github.com/trailofbits/skills" },
	{ name: "cybersecurity", repo: "github.com/mukul975/Anthropic-Cybersecurity-Skills" },
	{ name: "microsoft", repo: "github.com/microsoft/skills" },
];

export interface RegistryAddOptions {
	name?: string;
}

/**
 * Infer a registry name from a git URL.
 * Uses the last path segment of the normalized URL.
 */
export function inferRegistryName(url: string): string {
	const normalized = normalizeGitUrl(url);
	const segments = normalized.split("/");
	return segments[segments.length - 1] ?? normalized;
}

export async function registryAddCommand(
	url: string,
	opts: RegistryAddOptions,
	configPath?: string,
	cacheDir?: string,
): Promise<void> {
	// Store the cloneable URL (preserves git@ for SSH); use normalized form only for name inference
	const repo = cleanGitUrl(url);
	const name = opts.name ?? inferRegistryName(url);
	await addRegistry(name, repo, configPath);
	success(`Added registry '${name}' ${dim(`(${repo})`)}`);
	try {
		await registryUpdateCommand(name, configPath, cacheDir);
	} catch {
		console.log(`Run ${pc.cyan(`'skilltree registry update ${name}'`)} to index available skills.`);
	}
}

export async function registryRemoveCommand(
	name: string,
	configPath?: string,
	cacheDir?: string,
): Promise<void> {
	await removeRegistry(name, configPath);
	await cleanRegistryCache(name, cacheDir);
	success(`Removed registry '${name}'`);
}

export async function registryListCommand(
	configPath?: string,
	cacheDir?: string,
	opts?: { json?: boolean },
): Promise<void> {
	const registries = await listRegistries(configPath);

	if (registries.length === 0) {
		if (opts?.json) {
			console.log("[]");
			return;
		}
		console.log("No registries configured. Run 'skilltree registry add <url>' to add one.");
		return;
	}

	const rowData = await Promise.all(
		registries.map(async (reg) => {
			const index = await readRegistryIndex(reg.name, cacheDir);
			if (index) {
				return {
					name: reg.name,
					repo: reg.repo,
					entities: index.entities.length,
					updated_at: index.updated_at,
				};
			}
			return {
				name: reg.name,
				repo: reg.repo,
				entities: null as number | null,
				updated_at: null as string | null,
			};
		}),
	);

	if (opts?.json) {
		console.log(JSON.stringify(rowData, null, 2));
		return;
	}

	// Build display rows with formatted strings
	const rows = rowData.map((r) => ({
		name: r.name,
		repo: r.repo,
		entities: r.entities !== null ? r.entities.toString() : "--",
		updated: r.updated_at ? formatTimeAgo(new Date(r.updated_at)) : "never",
	}));

	// Calculate column widths
	const nameW = Math.max(4, ...rows.map((r) => r.name.length));
	const repoW = Math.max(4, ...rows.map((r) => r.repo.length));
	const entW = Math.max(8, ...rows.map((r) => r.entities.length));
	const updW = Math.max(12, ...rows.map((r) => r.updated.length));

	console.log(
		pc.bold(
			`  ${"Name".padEnd(nameW)}  ${"Repo".padEnd(repoW)}  ${"Entities".padEnd(entW)}  ${"Last Updated".padEnd(updW)}`,
		),
	);

	for (const row of rows) {
		console.log(
			`  ${pc.cyan(row.name.padEnd(nameW))}  ${dim(row.repo.padEnd(repoW))}  ${row.entities.padEnd(entW)}  ${dim(row.updated.padEnd(updW))}`,
		);
	}
}

export async function registryUpdateCommand(
	name?: string,
	configPath?: string,
	cacheDir?: string,
): Promise<void> {
	const registries = await listRegistries(configPath);

	if (registries.length === 0) {
		console.log("No registries configured. Run 'skilltree registry add <url>' to add one.");
		return;
	}

	const targets = name ? registries.filter((r) => r.name === name) : registries;

	if (name && targets.length === 0) {
		throw new Error(`Registry "${name}" not found`);
	}

	for (const reg of targets) {
		process.stdout.write(`Updating ${pc.cyan(reg.name)}... `);
		const repoDir = await ensureRegistryRepo(reg.name, reg.repo, cacheDir);
		const entities = await scanRegistry(repoDir);

		const skills = entities.filter((e) => e.type === "skill").length;
		const agents = entities.filter((e) => e.type === "agent").length;
		const commands = entities.filter((e) => e.type === "command").length;

		const index: RegistryIndex = {
			registry: reg.name,
			repo: reg.repo,
			updated_at: new Date().toISOString(),
			entities,
		};
		await writeRegistryIndex(index, cacheDir);

		const breakdown = [`${skills} skills`, `${agents} agents`];
		if (commands > 0) breakdown.push(`${commands} commands`);
		console.log(pc.green(`${entities.length} entities`) + dim(` (${breakdown.join(", ")})`));
	}
}

export interface RegistryInitOptions {
	skipUpdate?: boolean;
}

export async function registryInitCommand(
	opts: RegistryInitOptions = {},
	configPath?: string,
	cacheDir?: string,
): Promise<void> {
	const existing = await listRegistries(configPath);
	const existingRepos = new Set(existing.map((r) => r.repo));
	const existingNames = new Set(existing.map((r) => r.name));

	let added = 0;
	const skipped: string[] = [];

	for (const reg of DEFAULT_REGISTRIES) {
		if (existingRepos.has(reg.repo) || existingNames.has(reg.name)) {
			skipped.push(reg.name);
			continue;
		}
		await addRegistry(reg.name, reg.repo, configPath);
		added++;
		console.log(`  ${pc.green("+")} ${pc.cyan(reg.name)} ${dim(`(${reg.repo})`)}`);
	}

	if (added === 0) {
		console.log("All default registries already configured.");
		warn("Always inspect skill files before installing from repos you don't trust.");
		return;
	}

	success(`Added ${added} registr${added === 1 ? "y" : "ies"}.`);
	if (skipped.length > 0) {
		console.log(dim(`Skipped ${skipped.length} already configured: ${skipped.join(", ")}`));
	}

	if (!opts.skipUpdate) {
		console.log("");
		await registryUpdateCommand(undefined, configPath, cacheDir);
	} else {
		console.log(`\nRun ${pc.cyan("'skilltree registry update'")} to index available skills.`);
	}

	warn("Always inspect skill files before installing from repos you don't trust.");
}

function formatTimeAgo(date: Date): string {
	const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	const days = Math.floor(hours / 24);
	return `${days} day${days === 1 ? "" : "s"} ago`;
}
