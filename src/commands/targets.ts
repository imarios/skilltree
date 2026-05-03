import {
	detectInstalledAgents,
	getKnownAgentNames,
	pathToAgentName,
	resolveTarget,
} from "../core/agents.js";
import { loadManifestOrThrow, writeManifest } from "../core/manifest.js";
import { success, warn } from "../core/ui.js";
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
	success(`Added ${target} to install_targets.`);
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
	success(`Removed ${target} from install_targets.`);
}

export async function targetsDetectCommand(dir: string, opts?: TargetsOpts): Promise<void> {
	const manifest = await loadManifestOrThrow(dir, opts);
	guardLegacyField(manifest);

	const detected = await detectInstalledAgents(opts?.homeDir);
	const targets = ensureInstallTargets(manifest);
	let added = 0;

	for (const agent of detected) {
		if (!targets.includes(agent)) {
			targets.push(agent);
			added++;
		}
	}

	if (added > 0) {
		await writeManifest(dir, manifest);
		success(`Added ${added} agent(s) to install_targets.`);
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
