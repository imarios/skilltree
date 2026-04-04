import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { detectInstalledAgents } from "../core/agents.js";
import { globalManifestExists, MANIFEST_NEW, manifestExists } from "../core/filenames.js";
import { addGitignoreEntries, getSkillAgentIgnoreEntries } from "../core/gitignore.js";
import { serializeManifest, writeGlobalManifest } from "../core/manifest.js";
import { getGlobalDir } from "../core/paths.js";
import { dim, success, warn } from "../core/ui.js";
import type { Manifest } from "../types.js";

export interface InitOptions {
	global?: boolean;
	homeDir?: string; // Override home directory for agent detection (testing)
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

	const projectName = basename(dir);
	const manifest: Manifest = {
		name: projectName,
		install_targets: installTargets,
		dependencies: {},
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
