import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { createInterface } from "node:readline/promises";
import { detectInstalledAgents } from "../core/agents.js";
import {
	findExistingGlobalManifest,
	findExistingManifest,
	GLOBAL_MANIFEST,
	MANIFEST_NEW,
} from "../core/filenames.js";
import { addGitignoreEntries, getSkillAgentIgnoreEntriesForTarget } from "../core/gitignore.js";
import { serializeManifest, writeGlobalManifest } from "../core/manifest.js";
import { getGlobalDir } from "../core/paths.js";
import { type LocalEntry, scanLocalRepo } from "../core/repo-scanner.js";
import { dim, pluralize, success, warn } from "../core/ui.js";
import type { Dependency, LocalDependency, Manifest } from "../types.js";

/**
 * Trailing comment hint about the optional `scan.ignore` field. Surfaced in
 * the generated manifest so users discover the field without consulting the
 * docs. Keeps the active YAML minimal (no empty `scan:` block) while still
 * advertising the knob. Issue #52.
 */
const SCAN_HINT_COMMENT = `
# Optional: extend \`skilltree scan\`'s ignore list with names you intentionally
# don't declare as dependencies (e.g., internal slash commands not in any
# registry). Exact match — no prefix matching. See docs/specs/reference.md.
#
# scan:
#   ignore:
#     - my-internal-command
`;

export interface InitOptions {
	global?: boolean;
	homeDir?: string; // Override home directory for agent detection (testing)
	globalDir?: string; // Override global manifest dir (testing + --global flow)
	scan?: boolean;
	yes?: boolean;
	/** Test override: pick which discovered entries to include, bypassing interactive prompt. */
	selectFn?: (entries: LocalEntry[]) => Promise<LocalEntry[]>;
	/** Test override: canned answer for the interactive prompt — exercises the prompt pipeline without readline. */
	askFn?: (question: string) => Promise<string>;
	/** Override TTY detection. Defaults to process.stdout.isTTY. Tests should set this explicitly. */
	isInteractive?: boolean;
}

export async function initCommand(dir: string, options?: InitOptions): Promise<void> {
	if (options?.global) {
		return initGlobal(options.globalDir);
	}

	const manifestPath = `${dir}/${MANIFEST_NEW}`;

	// Guard: refuse to overwrite existing manifest. Report the actual on-disk
	// name so a project on the legacy .yaml extension doesn't get a misleading
	// "skilltree.yml already exists" — they don't have one.
	const existing = findExistingManifest(dir);
	if (existing) {
		throw new Error(`${existing} already exists. Remove it first or edit it directly.`);
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

	await writeFile(manifestPath, serializeManifest(manifest) + SCAN_HINT_COMMENT, "utf-8");
	success(`Created ${MANIFEST_NEW}`);

	// Update .gitignore for all targets. Resolve through the agent registry
	// (`getSkillAgentIgnoreEntriesForTarget`) so codex/copilot — whose install
	// dirs (`.agents`, `.github`) differ from `.${name}` — get the right
	// entries. Regression guard for #32.
	const ignoreEntries: string[] = [];
	for (const target of installTargets) {
		ignoreEntries.push(...getSkillAgentIgnoreEntriesForTarget(target));
	}
	// Deduplicate
	const uniqueEntries = [...new Set(ignoreEntries)];
	const added = await addGitignoreEntries(dir, uniqueEntries);
	if (added.length > 0) {
		success(`Updated .gitignore (added ${added.join(", ")})`);
	}
}

async function initGlobal(globalDirOverride?: string): Promise<void> {
	const globalDir = globalDirOverride ?? getGlobalDir();

	const existing = findExistingGlobalManifest(globalDir);
	if (existing) {
		warn(`${globalDir}/${existing} already exists. No changes made.`);
		return;
	}

	const manifest: Manifest = {
		dependencies: {},
	};

	await writeGlobalManifest(manifest, globalDir);
	success(`Created ${globalDir}/${GLOBAL_MANIFEST}`);
}

/**
 * Decide which discovered entries to include. Resolution order:
 *  1. Explicit `selectFn` (tests + future scripted flows) — bypass prompt entirely.
 *  2. No entries → nothing to include.
 *  3. `--yes` → include all without prompting.
 *  4. An `askFn` (test hook) or a TTY → prompt via that asker.
 *  5. Otherwise (non-TTY, no hooks) → include all (CI-safe default).
 */
async function selectDiscoveredEntries(
	entries: LocalEntry[],
	opts: InitOptions,
): Promise<LocalEntry[]> {
	if (opts.selectFn) return opts.selectFn(entries);
	if (entries.length === 0) return [];
	if (opts.yes) return entries;
	const interactive = opts.isInteractive ?? Boolean(process.stdout.isTTY);
	const ask = opts.askFn ?? (interactive ? readlineAsk : null);
	if (!ask) return entries;
	return promptForSelection(entries, ask);
}

type AskFn = (question: string) => Promise<string>;

async function promptForSelection(entries: LocalEntry[], ask: AskFn): Promise<LocalEntry[]> {
	printDiscovered(entries);
	const answer = (await ask("Include all? [Y/n/1,3,5] ")).trim();
	return parseSelectionAnswer(answer, entries);
}

async function readlineAsk(question: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await rl.question(question);
	} finally {
		rl.close();
	}
}

function printDiscovered(entries: LocalEntry[]): void {
	const skills = entries.filter((e) => e.type === "skill");
	const agents = entries.filter((e) => e.type === "agent");
	const commands = entries.filter((e) => e.type === "command");

	const skillStr = `${skills.length} ${pluralize("skill", skills.length)}`;
	const agentStr = `${agents.length} ${pluralize("agent", agents.length)}`;
	const commandStr = `${commands.length} ${pluralize("command", commands.length)}`;
	const summary =
		commands.length > 0
			? `${skillStr}, ${agentStr} and ${commandStr}`
			: `${skillStr} and ${agentStr}`;
	console.log(`\nFound ${summary}:\n`);

	let idx = 1;
	for (const section of [
		{ label: "Skills", items: skills },
		{ label: "Agents", items: agents },
		{ label: "Commands", items: commands },
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
