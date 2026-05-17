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
import { dim, success, warn } from "../core/ui.js";
import type { Manifest } from "../types.js";

interface TargetsOpts {
	global?: boolean;
	globalDir?: string;
	homeDir?: string;
	/** Only honoured by `targetsListCommand`. Other targets verbs ignore it. */
	json?: boolean;
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

	// Keep .gitignore in sync — but only remove entries that no remaining
	// target still needs. Two targets can resolve to the same install dir
	// (e.g., a literal path that aliases a known agent), so we compute the
	// set still in use and subtract. Fixes #33.
	const stillNeeded = new Set<string>();
	for (const remaining of targets) {
		for (const entry of getSkillAgentIgnoreEntriesForTarget(remaining)) {
			stillNeeded.add(entry);
		}
	}
	const candidates = getSkillAgentIgnoreEntriesForTarget(target).filter((e) => !stillNeeded.has(e));
	const removed = await removeGitignoreEntries(dir, candidates);
	success(`Removed ${target} from install_targets.`);
	if (removed.length > 0) {
		success(`Updated .gitignore (removed ${removed.join(", ")})`);
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
