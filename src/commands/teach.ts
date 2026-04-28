import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { detectInstalledAgents } from "../core/agents.js";
import { materializeBundledSkill } from "../core/bundled-skill.js";
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
	// Test override: directory to probe for the in-repo skill source. Pass a
	// non-existent path to force the embedded-bundle fallback (simulating a
	// compiled-binary install where `skills/skilltree/` isn't on disk).
	// Default: resolved from `import.meta.url` to find the repo's `skills/`.
	_devSourceDir?: string;
}

/**
 * Install the skilltree skill globally so coding agents know how to use skilltree.
 *
 * Uses the skilltree install pipeline: add --global + install --global.
 * Auto-detects installed agents and installs to all by default.
 */
export async function teachCommand(opts?: TeachOptions): Promise<void> {
	const detected = await detectInstalledAgents(opts?.homeDir);

	if (detected.length === 0) {
		throw new Error("no agents detected — use --agent <name> or install a coding agent first");
	}

	const agentsToInstall = opts?.agent ? [opts.agent] : detected;
	const globalDir = opts?.globalDir ?? getGlobalDir();
	const sourceDir = await findSkillSource(globalDir, opts?._devSourceDir);

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
	console.log(dim("For shell tab completion (zsh / bash):"));
	console.log(pc.cyan("  skilltree completion --install"));
}

/**
 * Locate the skilltree skill source. Tries the in-repo `skills/skilltree/`
 * next to this file first (`bun run dev`, tests, checkout-local invocation);
 * falls back to materializing the binary-embedded copy under
 * `globalDir/bundled/skilltree/`. We use a stable path rather than a temp
 * dir because it gets recorded as a `local:` dep in the global manifest and
 * is re-read on subsequent `skilltree install --global` runs.
 */
async function findSkillSource(globalDir: string, devSourceDir?: string): Promise<string> {
	const devPath =
		devSourceDir ??
		join(dirname(new URL(import.meta.url).pathname), "..", "..", "skills", "skilltree");
	try {
		await stat(join(devPath, "SKILL.md"));
		return devPath;
	} catch {
		// Fall through to the embedded bundle.
	}
	const bundledPath = join(globalDir, "bundled", "skilltree");
	await materializeBundledSkill(bundledPath);
	return bundledPath;
}
