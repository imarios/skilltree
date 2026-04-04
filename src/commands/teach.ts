import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { detectInstalledAgents, resolveGlobalTarget } from "../core/agents.js";
import { dim, pc, success } from "../core/ui.js";

export interface TeachOptions {
	homeDir?: string; // Override home directory for testing
	agent?: string; // Restrict to specific agent
}

/**
 * Install the skilltree skill globally so coding agents know how to use skilltree.
 *
 * Auto-detects installed agents and installs to all by default.
 * Use --agent to restrict to a specific agent.
 */
export async function teachCommand(opts?: TeachOptions): Promise<void> {
	const sourceDir = await findSkillSource();

	const detected = await detectInstalledAgents(opts?.homeDir);

	if (detected.length === 0) {
		throw new Error("no agents detected — use --agent <name> or install a coding agent first");
	}

	const agentsToInstall = opts?.agent ? [opts.agent] : detected;

	for (const agent of agentsToInstall) {
		const basePath = opts?.homeDir ? join(opts.homeDir, `.${agent}`) : resolveGlobalTarget(agent);
		const skillDir = join(basePath, "skills", "skilltree");

		try {
			await rm(skillDir, { recursive: true });
		} catch {
			// Doesn't exist yet
		}

		await mkdir(dirname(skillDir), { recursive: true });
		await cp(sourceDir, skillDir, { recursive: true });

		success(`Installed skilltree skill to ${skillDir}`);
	}

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
