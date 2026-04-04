import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { getTargetPath } from "../core/installer.js";
import {
	readGlobalLockfile,
	readLockfile,
	writeGlobalLockfile,
	writeLockfile,
} from "../core/lockfile.js";
import {
	getDevInstallPath,
	loadManifestOrThrow,
	writeGlobalManifest,
	writeManifest,
} from "../core/manifest.js";
import { getGlobalDir, getGlobalInstallBase } from "../core/paths.js";
import { dim, success } from "../core/ui.js";
import type { Lockfile } from "../types.js";

export interface RemoveOptions {
	force?: boolean;
	keepFiles?: boolean;
	global?: boolean;
	globalDir?: string; // test override
}

export async function removeCommand(
	name: string,
	dir: string,
	options: RemoveOptions,
): Promise<void> {
	const globalDir = options.globalDir ?? getGlobalDir();
	const isGlobal = !!options.global;

	const manifest = await loadManifestOrThrow(dir, { global: isGlobal, globalDir });
	const lockfile = isGlobal ? await readGlobalLockfile(globalDir) : await readLockfile(dir);

	validateRemoveTarget(name, manifest, lockfile, isGlobal);
	await confirmIfDependents(name, lockfile, options);

	// Remove from manifest
	removeFromManifest(name, manifest, isGlobal);

	if (isGlobal) {
		await writeGlobalManifest(manifest, globalDir);
	} else {
		await writeManifest(dir, manifest);
	}
	success(`Removed ${name} from ${isGlobal ? "global.yaml" : "skilltree.yaml"}`);

	const installBase = isGlobal ? getGlobalInstallBase() : join(dir, getDevInstallPath(manifest));

	// Remove installed files + orphans
	if (lockfile) {
		await deleteEntityFiles(name, lockfile, installBase, options.keepFiles);
		await cleanOrphans(lockfile, manifest, installBase, options.keepFiles);

		if (isGlobal) {
			await writeGlobalLockfile(lockfile, globalDir);
		} else {
			await writeLockfile(dir, lockfile);
		}
	}
}

function validateRemoveTarget(
	name: string,
	manifest: {
		dependencies?: Record<string, unknown>;
		"dev-dependencies"?: Record<string, unknown>;
	},
	lockfile: Lockfile | null,
	isGlobal: boolean,
): void {
	const inDeps = manifest.dependencies && name in manifest.dependencies;
	const inDevDeps =
		!isGlobal && manifest["dev-dependencies"] && name in manifest["dev-dependencies"];

	if (!inDeps && !inDevDeps) {
		const manifestName = isGlobal ? "global.yaml" : "skilltree.yaml";
		if (lockfile?.packages[name]) {
			throw new Error(
				`"${name}" is not in ${manifestName}. It is a transitive dependency. To stop installing it, remove or modify the parent dependency instead.`,
			);
		}
		throw new Error(`"${name}" is not in ${manifestName}.`);
	}
}

async function confirmIfDependents(
	name: string,
	lockfile: Lockfile | null,
	options: RemoveOptions,
): Promise<void> {
	if (!lockfile || options.force) return;
	const dependents = findDependents(name, lockfile);
	if (dependents.length === 0) return;

	const answer = await promptYesNo(
		`Warning: ${dependents.join(", ")} depends on ${name}. Remove anyway? [y/N] `,
	);
	if (!answer) {
		console.log("Aborted.");
		throw new Error("Aborted by user");
	}
}

function removeFromManifest(
	name: string,
	manifest: {
		dependencies?: Record<string, unknown>;
		"dev-dependencies"?: Record<string, unknown>;
	},
	isGlobal: boolean,
): void {
	if (manifest.dependencies && name in manifest.dependencies) {
		delete manifest.dependencies[name];
	}
	if (!isGlobal && manifest["dev-dependencies"] && name in manifest["dev-dependencies"]) {
		delete manifest["dev-dependencies"][name];
	}
}

async function deleteEntityFiles(
	name: string,
	lockfile: Lockfile,
	installBase: string,
	keepFiles?: boolean,
): Promise<void> {
	if (keepFiles) return;
	const entry = lockfile.packages[name];
	if (!entry) return;

	delete lockfile.packages[name];
	const targetPath = getTargetPath({ name, type: entry.type }, installBase);
	try {
		await rm(targetPath, { recursive: true });
		console.log(dim(`Removed installed files at ${targetPath}`));
	} catch {
		// Already removed
	}
}

async function cleanOrphans(
	lockfile: Lockfile,
	manifest: {
		dependencies?: Record<string, unknown>;
		"dev-dependencies"?: Record<string, unknown>;
	},
	installBase: string,
	keepFiles?: boolean,
): Promise<void> {
	const orphans = findOrphans(lockfile, manifest);
	for (const orphan of orphans) {
		const entry = lockfile.packages[orphan];
		delete lockfile.packages[orphan];
		if (!keepFiles && entry) {
			const targetPath = getTargetPath({ name: orphan, type: entry.type }, installBase);
			try {
				await rm(targetPath, { recursive: true });
			} catch {
				// Already removed
			}
			console.log(dim(`Removed orphaned transitive dependency: ${orphan}`));
		}
	}
}

function findDependents(name: string, lockfile: Lockfile): string[] {
	const dependents: string[] = [];
	for (const [key, entry] of Object.entries(lockfile.packages)) {
		if (entry.dependencies.includes(name)) {
			dependents.push(key);
		}
	}
	return dependents;
}

function findOrphans(
	lockfile: Lockfile,
	manifest: {
		dependencies?: Record<string, unknown>;
		"dev-dependencies"?: Record<string, unknown>;
	},
): string[] {
	const manifestKeys = new Set([
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest["dev-dependencies"] ?? {}),
	]);

	const reachable = new Set<string>();

	function walk(key: string): void {
		if (reachable.has(key)) return;
		reachable.add(key);
		const entry = lockfile.packages[key];
		if (entry) {
			for (const dep of entry.dependencies) {
				walk(dep);
			}
		}
	}

	for (const key of manifestKeys) {
		if (lockfile.packages[key]) {
			walk(key);
		}
	}

	return Object.keys(lockfile.packages).filter((key) => !reachable.has(key));
}

async function promptYesNo(question: string): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.toLowerCase() === "y");
		});
	});
}
