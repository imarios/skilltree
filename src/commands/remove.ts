import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { GLOBAL_MANIFEST, MANIFEST_NEW } from "../core/filenames.js";
import { getTargetPath } from "../core/installer.js";
import {
	buildNameIndex,
	readGlobalLockfile,
	readLockfile,
	writeGlobalLockfile,
	writeLockfile,
} from "../core/lockfile.js";
import {
	getInstallTargets,
	loadManifestOrThrow,
	validateManifestOrThrow,
	warnLegacyInstallPath,
	writeGlobalManifest,
	writeManifest,
} from "../core/manifest.js";
import { getGlobalDir, getGlobalInstallBase } from "../core/paths.js";
import { dim, dryRunBanner, pc, success } from "../core/ui.js";
import type { Lockfile, Manifest } from "../types.js";

export interface RemoveOptions {
	force?: boolean;
	keepFiles?: boolean;
	global?: boolean;
	globalDir?: string; // test override
	dryRun?: boolean;
	/**
	 * Scope the removal to `dev-dependencies` only. Without this, `remove`
	 * searches both groups (the default). With it, a same-named entry in
	 * `dependencies` is left intact; a name that lives only in `dependencies`
	 * errors out. Incompatible with `--global` (global manifests have no
	 * dev-deps).
	 */
	dev?: boolean;
}

export async function removeCommand(
	name: string,
	dir: string,
	options: RemoveOptions,
): Promise<void> {
	const globalDir = options.globalDir ?? getGlobalDir();
	const isGlobal = !!options.global;
	const devOnly = options.dev === true;

	// Mutex: global manifests have no `dev-dependencies`, so `--dev --global`
	// is meaningless. Reject explicitly rather than silently degrading to a
	// "name not in manifest" error that would mislead the user about why.
	if (devOnly && isGlobal) {
		throw new Error("--dev is not compatible with --global (global manifests have no dev-deps).");
	}

	const manifest = await loadManifestOrThrow(dir, { global: isGlobal, globalDir });
	// Validate first — match the install command's invariants so a malformed
	// global manifest (e.g., with `dev_install_path`) errors loudly instead of
	// silently using `~/.claude` and ignoring the user's stated intent.
	validateManifestOrThrow(manifest, isGlobal);
	if (!isGlobal) warnLegacyInstallPath(manifest);
	const lockfile = isGlobal ? await readGlobalLockfile(globalDir) : await readLockfile(dir);

	validateRemoveTarget(name, manifest, lockfile, isGlobal, devOnly);

	if (options.dryRun) {
		// In a preview we deliberately do NOT prompt for confirmation — there is
		// nothing to confirm and the user is just trying to see consequences.
		await previewRemove(name, manifest, lockfile, isGlobal, dir, options.keepFiles);
		return;
	}

	await confirmIfDependents(name, lockfile, options);

	// Remove from manifest
	removeFromManifest(name, manifest, isGlobal, devOnly);

	if (isGlobal) {
		await writeGlobalManifest(manifest, globalDir);
	} else {
		await writeManifest(dir, manifest);
	}
	success(`Removed ${name} from ${isGlobal ? GLOBAL_MANIFEST : MANIFEST_NEW}`);

	const installBases = resolveInstallBases(manifest, dir, isGlobal);

	// Remove installed files + orphans
	if (lockfile) {
		await deleteEntityFiles(name, lockfile, installBases, options.keepFiles);
		await cleanOrphans(lockfile, manifest, installBases, options.keepFiles);

		if (isGlobal) {
			await writeGlobalLockfile(lockfile, globalDir);
		} else {
			await writeLockfile(dir, lockfile);
		}
	}
}

/**
 * All install base directories (absolute paths) configured by the manifest.
 *
 * `remove` must clean files from EVERY configured target, not just the first
 * one — otherwise non-default targets (.agents/, .cursor/, .gemini/, ...) keep
 * orphan copies of the removed dep.
 */
function resolveInstallBases(manifest: Manifest, dir: string, isGlobal: boolean): string[] {
	if (isGlobal) {
		const targets = getInstallTargets(manifest, { global: true });
		return targets.length > 0 ? targets : [getGlobalInstallBase()];
	}
	return getInstallTargets(manifest).map((t) => join(dir, t));
}

async function previewRemove(
	name: string,
	manifest: Manifest,
	lockfile: Lockfile | null,
	isGlobal: boolean,
	dir: string,
	keepFiles?: boolean,
): Promise<void> {
	const manifestName = isGlobal ? GLOBAL_MANIFEST : MANIFEST_NEW;
	dryRunBanner();
	console.log(`Would remove ${pc.cyan(name)} from ${manifestName}`);

	if (!lockfile) return;

	// Mirror the live path: preview every configured install target so users
	// see all the dirs that would be touched, not just `.claude/`.
	const installBases = resolveInstallBases(manifest, dir, isGlobal);

	const entry = lockfile.packages[name];
	if (entry && !keepFiles) {
		for (const installBase of installBases) {
			const targetPath = getTargetPath({ name, type: entry.type }, installBase);
			console.log(dim(`Would remove installed files at ${targetPath}`));
		}
	}

	// Pure call — no clone needed. `excludeName` lets findOrphans answer
	// "what would be orphaned IF we removed this dep?" without mutating state.
	const orphans = findOrphans(lockfile, manifest, { excludeName: name });
	for (const orphan of orphans) {
		const orphanEntry = lockfile.packages[orphan];
		if (!orphanEntry) continue;
		if (keepFiles) {
			console.log(dim(`Would drop orphaned transitive dependency: ${orphan} (files kept)`));
		} else {
			for (const installBase of installBases) {
				const targetPath = getTargetPath({ name: orphan, type: orphanEntry.type }, installBase);
				console.log(dim(`Would remove orphaned transitive dependency: ${orphan} (${targetPath})`));
			}
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
	devOnly: boolean,
): void {
	const inDeps = manifest.dependencies && name in manifest.dependencies;
	const inDevDeps =
		!isGlobal && manifest["dev-dependencies"] && name in manifest["dev-dependencies"];

	// Scoped check: --dev cares ONLY about dev-dependencies. A prod-only entry
	// must error here, not get silently skipped — otherwise the user typing
	// `remove foo --dev` would see "successfully removed" output while foo is
	// still in `dependencies`.
	if (devOnly) {
		if (!inDevDeps) {
			throw new Error(`"${name}" is not in dev-dependencies.`);
		}
		return;
	}

	if (!inDeps && !inDevDeps) {
		const manifestName = isGlobal ? GLOBAL_MANIFEST : MANIFEST_NEW;
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
	devOnly: boolean,
): void {
	// `--dev` scopes deletion to dev-deps. Without it, both groups are cleared
	// (legacy behavior: same name in both groups gets fully removed).
	if (!devOnly && manifest.dependencies && name in manifest.dependencies) {
		delete manifest.dependencies[name];
	}
	if (!isGlobal && manifest["dev-dependencies"] && name in manifest["dev-dependencies"]) {
		delete manifest["dev-dependencies"][name];
	}
}

async function deleteEntityFiles(
	name: string,
	lockfile: Lockfile,
	installBases: string[],
	keepFiles?: boolean,
): Promise<void> {
	if (keepFiles) return;
	const entry = lockfile.packages[name];
	if (!entry) return;

	delete lockfile.packages[name];
	for (const installBase of installBases) {
		const targetPath = getTargetPath({ name, type: entry.type }, installBase);
		try {
			await rm(targetPath, { recursive: true });
			console.log(dim(`Removed installed files at ${targetPath}`));
		} catch {
			// Already removed
		}
	}
}

async function cleanOrphans(
	lockfile: Lockfile,
	manifest: {
		dependencies?: Record<string, unknown>;
		"dev-dependencies"?: Record<string, unknown>;
	},
	installBases: string[],
	keepFiles?: boolean,
): Promise<void> {
	const orphans = findOrphans(lockfile, manifest);
	for (const orphan of orphans) {
		const entry = lockfile.packages[orphan];
		delete lockfile.packages[orphan];
		if (!keepFiles && entry) {
			for (const installBase of installBases) {
				const targetPath = getTargetPath({ name: orphan, type: entry.type }, installBase);
				try {
					await rm(targetPath, { recursive: true });
				} catch {
					// Already removed
				}
			}
			console.log(dim(`Removed orphaned transitive dependency: ${orphan}`));
		}
	}
}

function findDependents(name: string, lockfile: Lockfile): string[] {
	// `name` is the YAML key the user is removing. `entry.dependencies`
	// contains entity NAMES (frontmatter), so a raw `.includes(name)` misses
	// aliased entries. Translate via the name index so the check matches
	// whether a sibling references the target by either form (issue #102).
	const nameIndex = buildNameIndex(lockfile);
	const dependents: string[] = [];
	for (const [key, entry] of Object.entries(lockfile.packages)) {
		const referencesTarget = entry.dependencies.some((dep) => nameIndex.get(dep) === name);
		if (referencesTarget) dependents.push(key);
	}
	return dependents;
}

function findOrphans(
	lockfile: Lockfile,
	manifest: {
		dependencies?: Record<string, unknown>;
		"dev-dependencies"?: Record<string, unknown>;
	},
	options?: { excludeName?: string },
): string[] {
	// `excludeName` lets dry-run callers ask "what would be orphaned if we
	// removed this name?" without mutating the manifest or lockfile. The
	// excluded name is treated as both removed-from-manifest AND removed-as-
	// reachable, so anything only kept alive by it surfaces as an orphan.
	const exclude = options?.excludeName;
	const manifestKeys = new Set([
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest["dev-dependencies"] ?? {}),
	]);
	if (exclude) manifestKeys.delete(exclude);

	// Walk children by YAML key so aliased entries stay reachable. Without
	// the translation, `walk("python-coding")` for an entry keyed `pc`
	// silently failed to mark `pc` reachable and the sweeper deleted it
	// (issue #102).
	const nameIndex = buildNameIndex(lockfile);
	const reachable = new Set<string>();

	function walk(key: string): void {
		if (reachable.has(key)) return;
		reachable.add(key);
		const entry = lockfile.packages[key];
		if (!entry) return;
		for (const dep of entry.dependencies) {
			const depKey = nameIndex.get(dep);
			if (depKey !== undefined) walk(depKey);
		}
	}

	for (const key of manifestKeys) {
		if (lockfile.packages[key]) {
			walk(key);
		}
	}

	return Object.keys(lockfile.packages).filter((key) => !reachable.has(key) && key !== exclude);
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
