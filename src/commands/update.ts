import { readFile, rm, writeFile } from "node:fs/promises";
import semver from "semver";
import {
	GLOBAL_MANIFEST,
	MANIFEST_NEW,
	resolveGlobalLockfilePath,
	resolveLockfilePath,
} from "../core/filenames.js";
import { canonicalRepo, ensureCached, listTags } from "../core/git.js";
import {
	readGlobalLockfile,
	readLockfile,
	writeGlobalLockfile,
	writeLockfile,
} from "../core/lockfile.js";
import { expandSources, loadManifestOrThrow } from "../core/manifest.js";
import { getGlobalDir } from "../core/paths.js";
import { filterSemverTags } from "../core/resolver.js";
import { dim, pc } from "../core/ui.js";
import type { Dependency, Lockfile } from "../types.js";
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

	const lockfilePath = isGlobal
		? resolveGlobalLockfilePath(globalDir).path
		: resolveLockfilePath(dir).path;

	// The lockfile as it was before `update` clears or trims it: the baseline
	// `install` prunes against (#205). Without it, install would find no record
	// of what it previously installed. A corrupt lockfile is no baseline, so
	// fall back to not pruning rather than failing an update that was about to
	// replace it anyway.
	const previousLockfile = await readLockfileOrNull(isGlobal, dir, globalDir);

	return withLockfileRollback(lockfilePath, !dryRun, async () => {
		if (!name) {
			return updateAll(dir, isGlobal, globalDir, dryRun, previousLockfile);
		}

		return selectiveUpdate(name, dir, isGlobal, globalDir, dryRun, previousLockfile);
	});
}

/**
 * Hold the lockfile's bytes in memory for the duration of `run` and put them
 * back if it throws (#204).
 *
 * `update` clears the lockfile to force a fresh resolution, so it is the one
 * command that destroys good pins before it knows whether it can produce new
 * ones. When resolution then failed, the user was left with nothing: `verify`,
 * `doctor` and `install --frozen` all stop working without a lockfile, and
 * `doctor` reports it as a missing file rather than as damage `update` did.
 * #67 fixed this ordering for --dry-run; this is the non-dry-run half.
 *
 * Restores the raw bytes rather than a parsed round trip, so a failed update
 * leaves the file exactly as the user had it instead of silently reformatting
 * it through our serializer.
 *
 * `enabled` is false under --dry-run, which mutates nothing.
 */
async function withLockfileRollback(
	lockfilePath: string,
	enabled: boolean,
	run: () => Promise<void>,
): Promise<void> {
	const previous = enabled ? await readFileOrNull(lockfilePath) : null;
	try {
		await run();
	} catch (err) {
		// Restore only what was there, and only if the run actually changed it:
		// a failure before the lockfile was touched (an unknown dep name, an
		// unreadable manifest) should not rewrite the file, and a project with
		// no lockfile must not have one conjured for it.
		if (previous !== null && (await readFileOrNull(lockfilePath)) !== previous) {
			await writeFile(lockfilePath, previous, "utf-8");
		}
		throw err;
	}
}

async function readLockfileOrNull(
	isGlobal: boolean,
	dir: string,
	globalDir: string,
): Promise<Lockfile | null> {
	try {
		return isGlobal ? await readGlobalLockfile(globalDir) : await readLockfile(dir);
	} catch {
		return null;
	}
}

async function readFileOrNull(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf-8");
	} catch {
		return null;
	}
}

async function updateAll(
	dir: string,
	isGlobal: boolean,
	globalDir: string,
	dryRun?: boolean,
	previousLockfile: Lockfile | null = null,
): Promise<void> {
	console.log(`Updating all ${isGlobal ? "global " : ""}dependencies...`);

	// Delete the lockfile to force full re-resolution. Skipped under --dry-run
	// so we don't mutate state during a preview (#67); restored by
	// `withLockfileRollback` if the re-resolution fails (#204).
	if (!dryRun) {
		const { path } = isGlobal ? resolveGlobalLockfilePath(globalDir) : resolveLockfilePath(dir);
		await rm(path, { force: true });
	}

	await installCommand(dir, {
		dryRun,
		force: true,
		reason: "update",
		previousLockfile,
		...(isGlobal ? { global: true, globalDir } : {}),
	});

	await reportFrozenDeps(dir, isGlobal, globalDir);
}

async function selectiveUpdate(
	name: string,
	dir: string,
	isGlobal: boolean,
	globalDir: string,
	dryRun?: boolean,
	previousLockfile: Lockfile | null = null,
): Promise<void> {
	console.log(`Updating ${name}...`);

	const manifest = await loadManifestOrThrow(dir, { global: isGlobal, globalDir });
	const lockfile = isGlobal ? await readGlobalLockfile(globalDir) : await readLockfile(dir);

	if (!lockfile) {
		await installCommand(dir, {
			dryRun,
			force: true,
			reason: "update",
			previousLockfile,
			...(isGlobal ? { global: true, globalDir } : {}),
		});
		return;
	}

	const expanded = expandSources(manifest);
	const allDeps = { ...expanded.dependencies, ...expanded["dev-dependencies"] };
	const dep = allDeps[name];
	if (!dep) {
		throw new Error(`"${name}" is not in ${isGlobal ? GLOBAL_MANIFEST : MANIFEST_NEW}.`);
	}

	// A frozen dep resolves at its tag no matter what `update` clears (#203).
	// Re-resolving would change nothing, so say why instead of printing "Done".
	if (isRemoteDependency(dep) && dep.frozen !== undefined) {
		console.log(
			`"${name}" is frozen at ${dep.frozen}. Run \`skilltree unfreeze ${name}\` to update it.`,
		);
		return;
	}

	// Clear lockfile entries for this dep (and same-repo siblings).
	// Under --dry-run we only count what would be cleared; we do not mutate
	// the in-memory lockfile or write it back.
	// Siblings are matched by canonical repo, so a respelled URL still counts (#203).
	const targetRepo = isRemoteDependency(dep) ? canonicalRepo(dep.repo) : undefined;
	let removedCount = 0;
	for (const [key, entry] of Object.entries(lockfile.packages)) {
		const sameRepo =
			targetRepo !== undefined &&
			entry.repo !== undefined &&
			canonicalRepo(entry.repo) === targetRepo;
		if (key === name || sameRepo) {
			if (!dryRun) {
				delete lockfile.packages[key];
			}
			removedCount++;
		}
	}

	if (!dryRun) {
		if (isGlobal) {
			await writeGlobalLockfile(lockfile, globalDir);
		} else {
			await writeLockfile(dir, lockfile);
		}
	}
	console.log(
		dim(
			`${dryRun ? "Would clear" : "Cleared"} ${removedCount} lockfile entries for re-resolution.`,
		),
	);

	await installCommand(dir, {
		dryRun,
		force: true,
		reason: "update",
		previousLockfile,
		...(isGlobal ? { global: true, globalDir } : {}),
	});

	await reportBlockingConstraint(name, dep, isGlobal ? GLOBAL_MANIFEST : MANIFEST_NEW);
}

/**
 * After updating everything, name the deps that stayed put because they are
 * frozen (#203) — the same missing sentence as `reportBlockingConstraint`, for
 * a pin the user made with `freeze` rather than a version range.
 *
 * The manifest was already loaded successfully by the install that just ran,
 * so a failure here is not worth failing the update over.
 */
async function reportFrozenDeps(dir: string, isGlobal: boolean, globalDir: string): Promise<void> {
	try {
		const expanded = expandSources(await loadManifestOrThrow(dir, { global: isGlobal, globalDir }));
		const deps = { ...expanded.dependencies, ...expanded["dev-dependencies"] };
		for (const [key, dep] of Object.entries(deps)) {
			if (!isRemoteDependency(dep) || dep.frozen === undefined) continue;
			console.log(dim(`${key}: frozen at ${dep.frozen} (skilltree unfreeze ${key} to update it)`));
		}
	} catch {
		// See above: a note, not a failure.
	}
}

/**
 * Say when the manifest constraint — not a failure — is why the version
 * didn't move (#184).
 *
 * Refusing to cross a constraint the author wrote is correct, and matches
 * npm. Doing it silently is not: `outdated` advertises the bump, `update`
 * prints "Done", and the version is unchanged with nothing connecting the
 * three. This is the missing sentence.
 *
 * Runs after `install`, so the repo cache is warm and `listTags` is a local
 * read rather than a fetch. Any lookup failure is silence: the update itself
 * has already succeeded by the time we get here, and a note about why a
 * version stayed put is not worth failing a successful command over.
 */
async function reportBlockingConstraint(
	name: string,
	dep: Dependency,
	manifestName: string,
): Promise<void> {
	if (!isRemoteDependency(dep)) return;
	const constraint = dep.version;
	// `*` can't block anything, and an absent constraint resolves the same way.
	if (constraint === undefined || constraint === "*") return;

	try {
		const latest = filterSemverTags(await listTags(await ensureCached(dep.repo)))[0]?.version;
		if (latest === undefined || semver.satisfies(latest, constraint)) return;
		console.log(
			`\n${pc.yellow(name)} is pinned at ${pc.yellow(constraint)} in ${manifestName}, so ${latest} was not taken.\n` +
				`Change the version constraint to take it.`,
		);
	} catch {
		// A cache or tag-listing failure costs the user an explanatory note,
		// not their update.
	}
}
