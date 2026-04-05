import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { detectInstalledAgents } from "../core/agents.js";
import { writeGlobalManifest } from "../core/manifest.js";
import { getGlobalDir } from "../core/paths.js";
import { dim, pc } from "../core/ui.js";
import type { Manifest } from "../types.js";
import { addCommand } from "./add.js";
import { installCommand } from "./install.js";

export interface TeachOptions {
	homeDir?: string; // Override home directory for testing
	agent?: string; // Restrict to specific agent
	globalDir?: string; // Override global config directory for testing
}

/**
 * Install the skilltree skill globally so coding agents know how to use skilltree.
 *
 * Uses the skilltree install pipeline: add --global + install --global.
 * Auto-detects installed agents and installs to all by default.
 */
export async function teachCommand(opts?: TeachOptions): Promise<void> {
	const sourceDir = await findSkillSource();

	const detected = await detectInstalledAgents(opts?.homeDir);

	if (detected.length === 0) {
		throw new Error("no agents detected — use --agent <name> or install a coding agent first");
	}

	const agentsToInstall = opts?.agent ? [opts.agent] : detected;
	const globalDir = opts?.globalDir ?? getGlobalDir();

	// Ensure global manifest exists with install_targets
	let manifest: Manifest;
	try {
		const { readGlobalManifest } = await import("../core/manifest.js");
		manifest = await readGlobalManifest(globalDir);
	} catch {
		manifest = { dependencies: {} };
	}

	// Set install_targets from detected agents
	manifest.install_targets = agentsToInstall;
	await writeGlobalManifest(manifest, globalDir);

	// Add skilltree as a global dependency
	await addCommand("skilltree", { local: sourceDir, global: true, globalDir }, "");

	// Install global deps (uses the full pipeline)
	await installCommand("", { global: true, globalDir });

	if (agentsToInstall.length > 1) {
		console.log(`\nInstalled to ${agentsToInstall.length} agents: ${agentsToInstall.join(", ")}`);
	}

	console.log("");
	console.log(dim("For shell tab completion, add to your ~/.zshrc:"));
	console.log(pc.cyan('  eval "$(skilltree completion zsh)"'));
}

/**
 * Locate the bundled skill source.
 * Tries: relative to this file (dev), then relative to the binary (compiled).
 */
async function findSkillSource(): Promise<string> {
	// Dev mode: relative to src/commands/teach.ts → ../../skills/skilltree/
	const devPath = join(
		dirname(new URL(import.meta.url).pathname),
		"..",
		"..",
		"skills",
		"skilltree",
	);
	try {
		await stat(join(devPath, "SKILL.md"));
		return devPath;
	} catch {
		// Not found at dev path
	}

	// Compiled mode: try CWD/skills/skilltree
	const cwdPath = join(process.cwd(), "skills", "skilltree");
	try {
		await stat(join(cwdPath, "SKILL.md"));
		return cwdPath;
	} catch {
		// Not found
	}

	throw new Error(
		"Could not find the skilltree skill source files. Ensure skills/skilltree/ exists in the project.",
	);
}
