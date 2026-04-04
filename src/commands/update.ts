import { rm } from "node:fs/promises";
import { resolveGlobalLockfilePath } from "../core/filenames.js";
import {
	readGlobalLockfile,
	readLockfile,
	writeGlobalLockfile,
	writeLockfile,
} from "../core/lockfile.js";
import { expandSources, loadManifestOrThrow } from "../core/manifest.js";
import { getGlobalDir } from "../core/paths.js";
import { dim } from "../core/ui.js";
import { isRemoteDependency } from "../types.js";
import { installCommand } from "./install.js";

export interface UpdateOptions {
	dryRun?: boolean;
	global?: boolean;
	globalDir?: string; // test override
}

export async function updateCommand(
	dir: string,
	name?: string,
	opts?: UpdateOptions,
): Promise<void> {
	const dryRun = opts?.dryRun;
	const isGlobal = !!opts?.global;
	const globalDir = opts?.globalDir ?? getGlobalDir();

	if (!name) {
		return updateAll(dir, isGlobal, globalDir, dryRun);
	}

	return selectiveUpdate(name, dir, isGlobal, globalDir, dryRun);
}

async function updateAll(
	dir: string,
	isGlobal: boolean,
	globalDir: string,
	dryRun?: boolean,
): Promise<void> {
	console.log(`Updating all ${isGlobal ? "global " : ""}dependencies...`);

	// Delete lockfile to force full re-resolution
	try {
		if (isGlobal) {
			const { path } = resolveGlobalLockfilePath(globalDir);
			await rm(path);
		} else {
			await rm(`${dir}/skilltree.lock`);
		}
	} catch {
		// No lockfile
	}

	await installCommand(dir, {
		dryRun,
		force: true,
		...(isGlobal ? { global: true, globalDir } : {}),
	});
}

async function selectiveUpdate(
	name: string,
	dir: string,
	isGlobal: boolean,
	globalDir: string,
	dryRun?: boolean,
): Promise<void> {
	console.log(`Updating ${name}...`);

	const manifest = await loadManifestOrThrow(dir, { global: isGlobal, globalDir });
	const lockfile = isGlobal ? await readGlobalLockfile(globalDir) : await readLockfile(dir);

	if (!lockfile) {
		await installCommand(dir, {
			dryRun,
			force: true,
			...(isGlobal ? { global: true, globalDir } : {}),
		});
		return;
	}

	const expanded = expandSources(manifest);
	const allDeps = { ...expanded.dependencies, ...expanded["dev-dependencies"] };
	const dep = allDeps[name];
	if (!dep) {
		throw new Error(`"${name}" is not in ${isGlobal ? "global.yaml" : "skilltree.yaml"}.`);
	}

	// Clear lockfile entries for this dep (and same-repo siblings)
	const targetRepo = isRemoteDependency(dep) ? dep.repo : undefined;
	let removedCount = 0;
	for (const [key, entry] of Object.entries(lockfile.packages)) {
		if (key === name || (targetRepo && entry.repo === targetRepo)) {
			delete lockfile.packages[key];
			removedCount++;
		}
	}

	if (isGlobal) {
		await writeGlobalLockfile(lockfile, globalDir);
	} else {
		await writeLockfile(dir, lockfile);
	}
	console.log(dim(`Cleared ${removedCount} lockfile entries for re-resolution.`));

	await installCommand(dir, {
		dryRun,
		force: true,
		...(isGlobal ? { global: true, globalDir } : {}),
	});
}
