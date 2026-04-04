import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { globalManifestExists, MANIFEST_NEW, manifestExists } from "../core/filenames.js";
import { addGitignoreEntries, getSkillAgentIgnoreEntries } from "../core/gitignore.js";
import { serializeManifest, writeGlobalManifest } from "../core/manifest.js";
import { getGlobalDir } from "../core/paths.js";
import { success, warn } from "../core/ui.js";
import type { Manifest } from "../types.js";

export async function initCommand(dir: string, options?: { global?: boolean }): Promise<void> {
	if (options?.global) {
		return initGlobal();
	}

	const manifestPath = `${dir}/${MANIFEST_NEW}`;

	// Guard: refuse to overwrite existing manifest
	if (manifestExists(dir)) {
		throw new Error(`${MANIFEST_NEW} already exists. Remove it first or edit it directly.`);
	}

	const projectName = basename(dir);
	const manifest: Manifest = {
		name: projectName,
		dev_install_path: ".claude",
		dependencies: {},
		"dev-dependencies": {},
	};

	await writeFile(manifestPath, serializeManifest(manifest), "utf-8");
	success(`Created ${MANIFEST_NEW}`);

	// Update .gitignore
	const ignoreEntries = getSkillAgentIgnoreEntries(".claude");
	const added = await addGitignoreEntries(dir, ignoreEntries);
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
