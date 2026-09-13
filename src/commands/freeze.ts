import { readFile, writeFile } from "node:fs/promises";
import {
	GLOBAL_MANIFEST,
	MANIFEST_NEW,
	resolveGlobalLockfilePath,
	resolveGlobalManifestPath,
	resolveLockfilePath,
	resolveManifestPath,
} from "../core/filenames.js";
import {
	ensureCached,
	FROZEN_REF_PREFIX,
	getCommitSha,
	listTags,
	readRef,
	writeRef,
} from "../core/git.js";
import {
	readGlobalLockfile,
	readLockfile,
	writeGlobalLockfile,
	writeLockfile,
} from "../core/lockfile.js";
import {
	expandSources,
	loadManifestOrThrow,
	parseFrozenVersion,
	validateManifestOrThrow,
	writeGlobalManifest,
	writeManifest,
} from "../core/manifest.js";
import { getGlobalDir } from "../core/paths.js";
import { filterSemverTags } from "../core/resolver.js";
import { dim, success, warn } from "../core/ui.js";
import type { Dependency, Lockfile, Manifest } from "../types.js";
import { isLocalDependency, isPackDependency, isRemoteDependency } from "../types.js";
import { installCommand } from "./install.js";

export interface FreezeOptions {
	dryRun?: boolean;
	global?: boolean;
	globalDir?: string; // test override
}

interface Scope {
	dir: string;
	isGlobal: boolean;
	globalDir: string;
	manifestName: string;
}

/**
 * `skilltree freeze <name> [tag]` — pin one dependency to an exact tag, outside
 * its repo's shared version resolution (#203).
 *
 * Without a tag, freezes at the version the lockfile already has: "keep what
 * I have" while upstream moves on. Writes `frozen:`, drops `version:` (the two
 * are mutually exclusive), records the tag's commit under the preserved ref,
 * and reinstalls so the lockfile and install match.
 */
export async function freezeCommand(
	dir: string,
	name: string,
	tag?: string,
	opts?: FreezeOptions,
): Promise<void> {
	const scope = resolveScope(dir, opts);
	const manifest = await loadManifestOrThrow(dir, {
		global: scope.isGlobal,
		globalDir: scope.globalDir,
	});
	validateManifestOrThrow(manifest, scope.isGlobal);
	const entry = findRemoteEntry(manifest, name, scope);
	const repo = entry.repo;

	const version = tag === undefined ? await lockedVersion(name, scope) : parseFrozenVersion(tag);
	if (version === null) {
		throw new Error(
			`"${tag}" is not an exact version tag. Freeze takes one tag like "0.4.0", not a range.`,
		);
	}
	const frozen = tag ?? version;

	const cachePath = await ensureCached(repo);
	const match = filterSemverTags(await listTags(cachePath)).find((t) => t.version === version);
	const preservedRef = `${FROZEN_REF_PREFIX}${version}`;
	const preserved = await readRef(cachePath, preservedRef);
	if (match === undefined && preserved === null) {
		throw new Error(`${repo} has no tag for ${version}, so "${name}" can't be frozen there.`);
	}

	const raw = rawEntry(manifest, name);
	// `*` is the default rather than a constraint the user chose, so dropping it
	// isn't worth reporting. `version:` is removed either way.
	const previousVersion = raw.version === "*" ? undefined : raw.version;

	if (opts?.dryRun === true) {
		console.log(`Would freeze ${name} at ${frozen}.`);
		if (previousVersion !== undefined) {
			console.log(dim(`  Would remove version: ${JSON.stringify(previousVersion)}`));
		}
		return;
	}

	if (match === undefined) {
		warn(
			`${repo} no longer has a tag for ${version}; freezing at the preserved commit ${preserved?.slice(0, 7)}.`,
		);
	} else {
		// Overwrite on purpose: re-freezing is how a user takes a tag that moved
		// upstream after the first freeze (resolveFrozen's warning says so).
		const commit = await getCommitSha(cachePath, `${match.tag}^{commit}`);
		if (preserved !== commit) await writeRef(cachePath, preservedRef, commit);
	}

	delete raw.version;
	raw.frozen = frozen;

	await rewriteAndInstall(scope, manifest, name, { clearLockedFrozen: true });

	success(`Froze ${name} at ${frozen}.`);
	if (previousVersion !== undefined) {
		console.log(
			dim(
				`  removed version: ${JSON.stringify(previousVersion)} (frozen and version are mutually exclusive)`,
			),
		);
	}
}

/**
 * `skilltree unfreeze <name>` — return a frozen dependency to its repo's shared
 * version (#203). The dep ends up with no `version:`, so it follows `*`; the
 * range it had before `freeze` isn't recoverable, and `freeze` said so.
 */
export async function unfreezeCommand(
	dir: string,
	name: string,
	opts?: FreezeOptions,
): Promise<void> {
	const scope = resolveScope(dir, opts);
	const manifest = await loadManifestOrThrow(dir, {
		global: scope.isGlobal,
		globalDir: scope.globalDir,
	});
	validateManifestOrThrow(manifest, scope.isGlobal);
	const entry = findRemoteEntry(manifest, name, scope);

	const raw = rawEntry(manifest, name);
	if (raw.frozen === undefined) {
		console.log(`"${name}" is not frozen.`);
		return;
	}

	if (opts?.dryRun === true) {
		console.log(`Would unfreeze ${name} (currently frozen at ${raw.frozen}).`);
		return;
	}

	delete raw.frozen;
	await rewriteAndInstall(scope, manifest, name, { clearLockedFrozen: false });

	success(`Unfroze ${name}; it follows ${entry.repo}'s version again.`);
}

function resolveScope(dir: string, opts: FreezeOptions | undefined): Scope {
	const isGlobal = opts?.global === true;
	return {
		dir,
		isGlobal,
		globalDir: opts?.globalDir ?? getGlobalDir(),
		manifestName: isGlobal ? GLOBAL_MANIFEST : MANIFEST_NEW,
	};
}

/**
 * The expanded `repo:` form of `<name>`, or an error explaining why it can't be
 * frozen. Checked on the expanded dep so a `source:` alias pointing at a local
 * path is reported as local, not as a repo.
 */
function findRemoteEntry(
	manifest: Manifest,
	name: string,
	scope: Scope,
): Extract<Dependency, { repo: string }> {
	const declared = manifest.dependencies?.[name] ?? manifest["dev-dependencies"]?.[name];
	if (declared === undefined) {
		throw new Error(`"${name}" is not in ${scope.manifestName}.`);
	}
	if (isPackDependency(declared)) {
		throw new Error(
			`"${name}" is a pack reference. Freeze the dependencies it expands to individually.`,
		);
	}
	const expanded = expandSources(manifest);
	const dep = expanded.dependencies?.[name] ?? expanded["dev-dependencies"]?.[name];
	if (dep === undefined || isLocalDependency(dep)) {
		throw new Error(`"${name}" is a local dependency; local deps have no tags to freeze.`);
	}
	if (!isRemoteDependency(dep)) {
		throw new Error(`"${name}" has no repo to freeze.`);
	}
	return dep;
}

/** The manifest's own entry object for `<name>`, for in-place edits. */
function rawEntry(manifest: Manifest, name: string): Record<string, unknown> {
	const declared = manifest.dependencies?.[name] ?? manifest["dev-dependencies"]?.[name];
	return declared as unknown as Record<string, unknown>;
}

async function lockedVersion(name: string, scope: Scope): Promise<string> {
	const lockfile = await readScopeLockfile(scope);
	const version = lockfile?.packages[name]?.version;
	if (version === undefined) {
		throw new Error(
			`"${name}" has no locked version to freeze at (not installed yet, or its repo has no tags); pass a tag: skilltree freeze ${name} <tag>`,
		);
	}
	return version;
}

async function readScopeLockfile(scope: Scope): Promise<Lockfile | null> {
	return scope.isGlobal ? readGlobalLockfile(scope.globalDir) : readLockfile(scope.dir);
}

/**
 * Write the edited manifest and reinstall.
 *
 * Freezing and unfreezing change `frozen:`, which the manifest/lockfile diff
 * already treats as a change. Re-freezing at the version the lockfile already
 * records is the one case it can't see — a moved tag changes the commit, not
 * the version — so `clearLockedFrozen` removes the entry's frozen marker to
 * force re-resolution. The entry itself stays: install needs its previous
 * commit to know the files on disk are stale and must be replaced.
 *
 * If install fails, both files go back to their original bytes, so a failed
 * freeze leaves the project as it was.
 */
async function rewriteAndInstall(
	scope: Scope,
	manifest: Manifest,
	name: string,
	{ clearLockedFrozen }: { clearLockedFrozen: boolean },
): Promise<void> {
	const manifestPath = scope.isGlobal
		? resolveGlobalManifestPath(scope.globalDir).path
		: resolveManifestPath(scope.dir).path;
	const lockfilePath = scope.isGlobal
		? resolveGlobalLockfilePath(scope.globalDir).path
		: resolveLockfilePath(scope.dir).path;
	const manifestBefore = await readFileOrNull(manifestPath);
	const lockfileBefore = await readFileOrNull(lockfilePath);

	try {
		if (scope.isGlobal) {
			await writeGlobalManifest(manifest, scope.globalDir);
		} else {
			await writeManifest(scope.dir, manifest);
		}

		const lockfile = await readScopeLockfile(scope);
		const locked = lockfile?.packages[name];
		if (clearLockedFrozen && lockfile !== null && locked?.frozen !== undefined) {
			delete locked.frozen;
			if (scope.isGlobal) {
				await writeGlobalLockfile(lockfile, scope.globalDir);
			} else {
				await writeLockfile(scope.dir, lockfile);
			}
		}

		await installCommand(
			scope.dir,
			scope.isGlobal ? { global: true, globalDir: scope.globalDir } : {},
		);
	} catch (err) {
		if (manifestBefore !== null) await writeFile(manifestPath, manifestBefore, "utf-8");
		if (lockfileBefore !== null) await writeFile(lockfilePath, lockfileBefore, "utf-8");
		throw err;
	}
}

async function readFileOrNull(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf-8");
	} catch {
		return null;
	}
}
