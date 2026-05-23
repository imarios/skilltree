import { readdir, rm, rmdir, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
	detectInstalledAgents,
	getKnownAgentNames,
	pathToAgentName,
	resolveTarget,
} from "../core/agents.js";
import {
	addGitignoreEntries,
	getSkillAgentIgnoreEntriesForTarget,
	removeGitignoreEntries,
} from "../core/gitignore.js";
import { loadManifestOrThrow, writeManifest } from "../core/manifest.js";
import { canonicalPath, expandTilde, isLocalSource } from "../core/paths.js";
import { dim, success, warn } from "../core/ui.js";
import type { Manifest } from "../types.js";

interface TargetsOpts {
	global?: boolean;
	globalDir?: string;
	homeDir?: string;
	/** Only honoured by `targetsListCommand`. Other targets verbs ignore it. */
	json?: boolean;
	/**
	 * Honoured by `targetsRemoveCommand`. When true: leave installed files on
	 * disk AND keep the gitignore entries so the orphan stays ignored. Mirrors
	 * `skilltree remove --keep-files`. See issue #72.
	 */
	keepFiles?: boolean;
}

/**
 * Guard: error if dev_install_path or install_path is still set.
 * Directs user to run `skilltree targets migrate` first.
 */
function guardLegacyField(manifest: Manifest): void {
	if (manifest.dev_install_path || manifest.install_path) {
		throw new Error(
			"cannot modify install_targets while dev_install_path is set. Run: skilltree targets migrate",
		);
	}
}

/**
 * Ensure install_targets exists on the manifest.
 * If absent, initialize with the default [claude].
 */
function ensureInstallTargets(manifest: Manifest): string[] {
	if (!manifest.install_targets) {
		manifest.install_targets = ["claude"];
	}
	return manifest.install_targets;
}

/**
 * Per-entry resolution result for `resolveTargets`. Doctor's D8 target-
 * consistency check consumes these to surface per-target problems without
 * crashing on the first bad entry. Spec: docs/specs/doctor.md §D8.
 */
export interface TargetResolution {
	target: string;
	ok: boolean;
	/** The resolved directory (agent dir for known bare words, literal otherwise). */
	path?: string;
	/** Present when `ok === false`. */
	error?: string;
}

/**
 * Non-throwing variant of `resolveTarget` over a list of targets. Each entry
 * is resolved independently; an unknown agent or missing path becomes a
 * `{ok: false}` row instead of throwing. For literal paths (containing `/`
 * or starting with `~`) the helper also `stat`s the path and reports it as
 * `ok: false` if missing.
 *
 * Used by `skilltree doctor` (Nitrogen Phase 2) for the D8 target-
 * consistency check.
 */
export async function resolveTargets(targets: string[]): Promise<TargetResolution[]> {
	const out: TargetResolution[] = [];
	for (const target of targets) {
		out.push(await resolveOneTarget(target));
	}
	return out;
}

async function resolveOneTarget(target: string): Promise<TargetResolution> {
	let resolvedPath: string;
	try {
		resolvedPath = resolveTarget(target);
	} catch (err) {
		return {
			target,
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}

	// Bare-word agent inputs ("claude" → ".claude") are project-relative
	// install destinations that may or may not exist yet — the install step
	// creates them. Don't probe those. Literal-path inputs (./, /, ~/) are
	// user-supplied directories we expect to exist; probe them so a typo'd
	// path doesn't silently install nowhere.
	if (!isLocalSource(target)) {
		return { target, ok: true, path: resolvedPath };
	}

	const expanded = expandTilde(resolvedPath);
	const probe = isAbsolute(expanded) ? expanded : join(process.cwd(), expanded);
	try {
		await stat(probe);
	} catch {
		return {
			target,
			ok: false,
			path: resolvedPath,
			error: `path does not exist: ${resolvedPath}`,
		};
	}

	return { target, ok: true, path: resolvedPath };
}

interface TargetsListRow {
	name: string;
	path: string;
	detected: boolean;
	configured: boolean;
}

function buildTargetsListRows(
	targets: string[],
	detected: string[],
	knownAgents: string[],
): TargetsListRow[] {
	const rows: TargetsListRow[] = [];
	// Known agents — always listed so consumers see "available but not configured" too
	for (const name of knownAgents) {
		rows.push({
			name,
			path: resolveTarget(name),
			detected: detected.includes(name),
			configured: targets.includes(name),
		});
	}
	// Custom (non-agent) entries from install_targets — paths configured by
	// the user. Dedupe by name so a hand-edited manifest with repeated paths
	// doesn't produce duplicate rows; `targetsAddCommand` already guards on
	// insert, but we can't trust that for arbitrary YAML edits.
	const seen = new Set<string>(knownAgents);
	for (const target of targets) {
		if (seen.has(target)) continue;
		seen.add(target);
		rows.push({ name: target, path: target, detected: false, configured: true });
	}
	return rows;
}

export async function targetsListCommand(dir: string, opts?: TargetsOpts): Promise<void> {
	const manifest = await loadManifestOrThrow(dir, opts);
	const targets = manifest.install_targets ?? [];
	const detected = await detectInstalledAgents(opts?.homeDir);
	const knownAgents = getKnownAgentNames();

	const rows = buildTargetsListRows(targets, detected, knownAgents);

	if (opts?.json) {
		console.log(JSON.stringify(rows, null, 2));
		return;
	}

	console.log("Detected     In targets   Name        Path");
	for (const row of rows) {
		const detectedCol = row.detected ? "  ✔" : "   ";
		const targetCol = row.configured ? "  ✔" : "   ";
		console.log(
			`${detectedCol.padEnd(13)}${targetCol.padEnd(13)}${row.name.padEnd(12)}${row.path}`,
		);
	}
}

export async function targetsAddCommand(
	target: string,
	dir: string,
	opts?: TargetsOpts,
): Promise<void> {
	const manifest = await loadManifestOrThrow(dir, opts);
	guardLegacyField(manifest);

	// Validate target (throws for unknown bare words)
	resolveTarget(target);

	const targets = ensureInstallTargets(manifest);

	if (targets.includes(target)) {
		throw new Error(`${target} already in install_targets`);
	}

	targets.push(target);
	await writeManifest(dir, manifest);

	// Keep .gitignore in sync — installer writes to the new target's dir, so
	// it must be ignored. Fixes #33: previously only `init` touched gitignore,
	// leaving anything added later un-ignored. `addGitignoreEntries` is a no-op
	// for entries that already exist, so re-adding is safe.
	const added = await addGitignoreEntries(dir, getSkillAgentIgnoreEntriesForTarget(target));
	success(`Added ${target} to install_targets.`);
	if (added.length > 0) {
		success(`Updated .gitignore (added ${added.join(", ")})`);
	}
	// Parity with `add` (issue #74, Friction B): the new target's install dir is
	// empty until `install` runs. Make that step explicit so users aren't left
	// wondering why `.<target>/skills/` is blank.
	console.log(dim("  Run `skilltree install` to populate the new target."));
}

export async function targetsRemoveCommand(
	target: string,
	dir: string,
	opts?: TargetsOpts,
): Promise<void> {
	const manifest = await loadManifestOrThrow(dir, opts);
	guardLegacyField(manifest);

	const targets = manifest.install_targets ?? [];
	const idx = targets.indexOf(target);

	if (idx === -1) {
		throw new Error(`${target} not in install_targets`);
	}

	if (targets.length <= 1) {
		throw new Error("cannot remove last target — at least one required");
	}

	targets.splice(idx, 1);
	await writeManifest(dir, manifest);

	const sharedWithRemaining = remainingTargetsResolveSameDir(target, targets);

	// Delete the on-disk install artifacts unless the user opted out, AND
	// only when no remaining target still resolves to the same install dir.
	// Order: delete files first, then update .gitignore — that way a failed
	// delete leaves the gitignore entries in place and the orphan stays
	// ignored. See issue #72.
	const filesDeleted = !opts?.keepFiles && !sharedWithRemaining;
	if (filesDeleted) {
		await pruneInstalledTargetDir(dir, target);
	}

	// Keep .gitignore in sync — but only remove entries that no remaining
	// target still needs (existing #33 fix preserved). When --keep-files is
	// set, also keep the gitignore entries so the leftover orphan doesn't
	// surface to `git add .` — that's the whole point of --keep-files.
	const candidates = opts?.keepFiles
		? []
		: getSkillAgentIgnoreEntriesForTarget(target).filter((entry) => {
				const stillNeeded = new Set<string>();
				for (const remaining of targets) {
					for (const e of getSkillAgentIgnoreEntriesForTarget(remaining)) {
						stillNeeded.add(e);
					}
				}
				return !stillNeeded.has(entry);
			});
	const removed = await removeGitignoreEntries(dir, candidates);
	success(`Removed ${target} from install_targets.`);
	if (removed.length > 0) {
		success(`Updated .gitignore (removed ${removed.join(", ")})`);
	}
	if (opts?.keepFiles) {
		console.log(dim("  --keep-files: installed artifacts left in place."));
	}
}

/**
 * True when any remaining target resolves to the same install directory as
 * the one being removed. Prevents `targets remove` from trampling a sibling
 * target's installed artifacts when the user has aliased a known agent
 * (e.g. `claude` + `./.claude` both resolving to `.claude`). See issue #72.
 */
function remainingTargetsResolveSameDir(removed: string, remaining: string[]): boolean {
	const removedDir = safeResolveTarget(removed);
	if (removedDir === null) return false;
	const removedCanon = canonicalPath(removedDir);
	for (const candidate of remaining) {
		const dir = safeResolveTarget(candidate);
		if (dir === null) continue;
		if (canonicalPath(dir) === removedCanon) return true;
	}
	return false;
}

function safeResolveTarget(target: string): string | null {
	try {
		return resolveTarget(target);
	} catch {
		return null;
	}
}

/**
 * Best-effort cleanup of the `<target>/skills/`, `<target>/agents/`, and
 * `<target>/commands/` subtrees installed for the removed target. Errors are
 * swallowed — the cleanup is convenience, not correctness; the user can
 * always rm the dirs themselves. After pruning the managed subdirs, attempts
 * to remove the parent directory iff it's now empty (so unrelated user files
 * under the same dir are preserved). Issue #72.
 */
async function pruneInstalledTargetDir(dir: string, target: string): Promise<void> {
	const targetDir = safeResolveTarget(target);
	if (targetDir === null) return;
	const base = join(dir, targetDir);
	for (const subdir of ["skills", "agents", "commands"]) {
		const full = join(base, subdir);
		try {
			await rm(full, { recursive: true, force: true });
		} catch {
			// Best-effort
		}
	}
	// If the parent dir is now empty (no user files snuck in), drop it too.
	try {
		const remaining = await readdir(base);
		if (remaining.length === 0) await rmdir(base);
	} catch {
		// Parent didn't exist or has user files — leave it alone
	}
}

export async function targetsDetectCommand(dir: string, opts?: TargetsOpts): Promise<void> {
	const manifest = await loadManifestOrThrow(dir, opts);
	guardLegacyField(manifest);

	const detected = await detectInstalledAgents(opts?.homeDir);
	const targets = ensureInstallTargets(manifest);
	const newlyAdded: string[] = [];

	for (const agent of detected) {
		if (!targets.includes(agent)) {
			targets.push(agent);
			newlyAdded.push(agent);
		}
	}

	if (newlyAdded.length > 0) {
		await writeManifest(dir, manifest);
		// Same #33 fix: keep .gitignore in sync for every newly added agent.
		const ignoreEntries = newlyAdded.flatMap((t) => getSkillAgentIgnoreEntriesForTarget(t));
		const addedToIgnore = await addGitignoreEntries(dir, ignoreEntries);
		success(`Added ${newlyAdded.length} agent(s) to install_targets.`);
		if (addedToIgnore.length > 0) {
			success(`Updated .gitignore (added ${addedToIgnore.join(", ")})`);
		}
		// Parity with `targets add` (issue #74, Friction B): new dirs are empty
		// until `install` runs.
		console.log(dim("  Run `skilltree install` to populate the new target(s)."));
	} else {
		console.log("All detected agents already in install_targets.");
	}
}

export async function targetsMigrateCommand(dir: string, opts?: TargetsOpts): Promise<void> {
	const manifest = await loadManifestOrThrow(dir, opts);

	const legacyPath = manifest.dev_install_path ?? manifest.install_path;
	if (!legacyPath) {
		warn("nothing to migrate — dev_install_path not set");
		return;
	}

	// Reverse lookup: known agent dir → agent name, otherwise literal path
	const agentName = pathToAgentName(legacyPath);
	const target = agentName ?? `./${legacyPath}`;

	manifest.install_targets = [target];
	delete manifest.dev_install_path;
	delete manifest.install_path;

	await writeManifest(dir, manifest);
	success(`Migrated dev_install_path: ${legacyPath} → install_targets: [${target}]`);
}
