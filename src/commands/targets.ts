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

export async function targetsListCommand(dir: string, opts?: TargetsOpts): Promise<void> {
	const manifest = await loadManifestOrThrow(dir, opts);
	const targets = manifest.install_targets ?? [];
	const detected = await detectInstalledAgents(opts?.homeDir);
	const knownAgents = getKnownAgentNames();

	console.log("Detected     In targets   Name        Path");

	// Show known agents
	for (const name of knownAgents) {
		const isDetected = detected.includes(name);
		const isTarget = targets.includes(name);
		const dir = resolveTarget(name);
		const detectedCol = isDetected ? "  ✔" : "   ";
		const targetCol = isTarget ? "  ✔" : "   ";
		console.log(`${detectedCol.padEnd(13)}${targetCol.padEnd(13)}${name.padEnd(12)}${dir}`);
	}

	// Show custom paths
	for (const target of targets) {
		if (!knownAgents.includes(target)) {
			console.log(`${"   ".padEnd(13)}${"  ✔".padEnd(13)}${target.padEnd(12)}${target}`);
		}
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
