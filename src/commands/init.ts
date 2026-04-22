import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { createInterface } from "node:readline/promises";
import { detectInstalledAgents } from "../core/agents.js";
import { globalManifestExists, MANIFEST_NEW, manifestExists } from "../core/filenames.js";
import { addGitignoreEntries, getSkillAgentIgnoreEntries } from "../core/gitignore.js";
import { serializeManifest, writeGlobalManifest } from "../core/manifest.js";
import { getGlobalDir } from "../core/paths.js";
import { type LocalEntry, scanLocalRepo } from "../core/repo-scanner.js";
import { dim, success, warn } from "../core/ui.js";
import type { Dependency, LocalDependency, Manifest } from "../types.js";

export interface InitOptions {
	global?: boolean;
	homeDir?: string; // Override home directory for agent detection (testing)
	scan?: boolean;
	yes?: boolean;
	/** Test override: pick which discovered entries to include, bypassing interactive prompt. */
	selectFn?: (entries: LocalEntry[]) => Promise<LocalEntry[]>;
}

export async function initCommand(dir: string, options?: InitOptions): Promise<void> {
	if (options?.global) {
		return initGlobal();
	}

	const manifestPath = `${dir}/${MANIFEST_NEW}`;

	// Guard: refuse to overwrite existing manifest
	if (manifestExists(dir)) {
		throw new Error(`${MANIFEST_NEW} already exists. Remove it first or edit it directly.`);
	}

	// Auto-detect installed agents
	const detected = await detectInstalledAgents(options?.homeDir);
	const installTargets = detected.length > 0 ? detected : ["claude"];

	if (detected.length > 0) {
		console.log(dim(`Detected agents: ${detected.join(", ")}`));
	} else {
		console.log(dim("No agents detected — defaulting to claude"));
	}

	// Optional repo scan for in-tree skills and agents.
	const dependencies: Record<string, Dependency> = {};
	if (options?.scan) {
		const discovered = await scanLocalRepo(dir);
		const selected = await selectDiscoveredEntries(discovered, options);
		for (const entry of selected) {
			const dep: LocalDependency = {
				local: toLocalPathValue(entry.path),
				type: entry.type,
			};
			dependencies[entry.name] = dep;
		}
		if (selected.length > 0) {
			console.log(dim(`Registered ${selected.length} local ${pluralize("dep", selected.length)}.`));
		} else if (discovered.length === 0) {
			console.log(dim("No skills or agents found in the repo."));
		}
	}

	const projectName = basename(dir);
	const manifest: Manifest = {
		name: projectName,
		install_targets: installTargets,
		dependencies,
		"dev-dependencies": {},
	};

	await writeFile(manifestPath, serializeManifest(manifest), "utf-8");
	success(`Created ${MANIFEST_NEW}`);

	// Update .gitignore for all targets
	const ignoreEntries: string[] = [];
	for (const target of installTargets) {
		const resolvedDir = target.startsWith(".") || target.startsWith("/") ? target : `.${target}`;
		ignoreEntries.push(...getSkillAgentIgnoreEntries(resolvedDir));
	}
	// Deduplicate
	const uniqueEntries = [...new Set(ignoreEntries)];
	const added = await addGitignoreEntries(dir, uniqueEntries);
	if (added.length > 0) {
		success(`Updated .gitignore (added ${added.join(", ")})`);
	}
}

async function initGlobal(): Promise<void> {
	const globalDir = getGlobalDir();

	if (globalManifestExists(globalDir)) {
		warn(`${globalDir}/global.yaml already exists. No changes made.`);
		return;
	}

	const manifest: Manifest = {
		dependencies: {},
	};

	await writeGlobalManifest(manifest, globalDir);
	success(`Created ${globalDir}/global.yaml`);
}

/**
 * Decide which discovered entries to include. Resolution order:
 *  1. Explicit `selectFn` (tests + future scripted flows).
 *  2. `--yes`, or no entries, or non-TTY → include all (CI-safe default).
 *  3. Interactive prompt — Y/n or comma-separated index list.
 */
async function selectDiscoveredEntries(
	entries: LocalEntry[],
	opts: InitOptions,
): Promise<LocalEntry[]> {
	if (opts.selectFn) return opts.selectFn(entries);
	if (entries.length === 0) return [];
	if (opts.yes || !process.stdout.isTTY) return entries;
	return promptForSelection(entries);
}

async function promptForSelection(entries: LocalEntry[]): Promise<LocalEntry[]> {
	printDiscovered(entries);

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	let answer: string;
	try {
		answer = (await rl.question("Include all? [Y/n/1,3,5] ")).trim();
	} finally {
		rl.close();
	}

	return parseSelectionAnswer(answer, entries);
}

function printDiscovered(entries: LocalEntry[]): void {
	const skills = entries.filter((e) => e.type === "skill");
	const agents = entries.filter((e) => e.type === "agent");

	console.log(
		`\nFound ${skills.length} skill${skills.length === 1 ? "" : "s"} and ${agents.length} agent${agents.length === 1 ? "" : "s"}:\n`,
	);

	let idx = 1;
	for (const section of [
		{ label: "Skills", items: skills },
		{ label: "Agents", items: agents },
	]) {
		if (section.items.length === 0) continue;
		console.log(`${section.label}:`);
		for (const e of section.items) {
			console.log(`  [${idx}] ${e.name.padEnd(24)} ${dim(e.path)}`);
			idx++;
		}
		console.log("");
	}
}

/**
 * Parse the user's reply to the selection prompt.
 *
 * - Empty / `y` / `Y` → include all
 * - `n` / `N` → include none
 * - Comma-separated integers (1-based, matching the printed numbering) → subset
 * - Invalid indices and garbage are ignored rather than failing the init —
 *   the user can always re-run or hand-edit the manifest.
 */
export function parseSelectionAnswer(answer: string, entries: LocalEntry[]): LocalEntry[] {
	const trimmed = answer.trim();
	if (trimmed === "" || trimmed.toLowerCase() === "y") return entries;
	if (trimmed.toLowerCase() === "n") return [];

	const indices = trimmed
		.split(",")
		.map((s) => Number.parseInt(s.trim(), 10))
		.filter((n) => Number.isInteger(n) && n >= 1 && n <= entries.length);

	const selected: LocalEntry[] = [];
	const seen = new Set<number>();
	for (const i of indices) {
		if (seen.has(i)) continue;
		seen.add(i);
		const entry = entries[i - 1];
		if (entry) selected.push(entry);
	}
	return selected;
}

/**
 * Format a scanner-relative path (always POSIX, no leading ./) into the
 * form we write into the manifest: `./rel/path`.
 */
function toLocalPathValue(scanPath: string): string {
	if (scanPath === "." || scanPath === "") return ".";
	return scanPath.startsWith("./") ? scanPath : `./${scanPath}`;
}

function pluralize(word: string, n: number): string {
	return n === 1 ? word : `${word}s`;
}
