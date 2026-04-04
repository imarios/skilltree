import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getGlobalInstallBase } from "../core/paths.js";
import { dim, pc, success } from "../core/ui.js";

/**
 * Install the skilltree skill globally (or to a target directory) so
 * Claude Code sessions know how to use skilltree.
 *
 * Default target: ~/.claude/skills/skilltree/
 */
export async function teachCommand(target?: string): Promise<void> {
	const basePath = target ?? getGlobalInstallBase();
	const skillDir = join(basePath, "skills", "skilltree");

	// Find the source skill directory (shipped with skilltree)
	const sourceDir = await findSkillSource();

	// Clean and copy
	try {
		await rm(skillDir, { recursive: true });
	} catch {
		// Doesn't exist yet
	}

	await mkdir(dirname(skillDir), { recursive: true });
	await cp(sourceDir, skillDir, { recursive: true });

	success(`Installed skilltree skill to ${skillDir}`);
	console.log("All Claude Code sessions will now know how to use skilltree.");
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
