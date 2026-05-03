import { join } from "node:path";
import { GLOBAL_MANIFEST, MANIFEST_NEW } from "../core/filenames.js";
import { resolveAll } from "../core/graph.js";
import type { VerifyStatus } from "../core/installer.js";
import { verifyInstalled } from "../core/installer.js";
import { readGlobalLockfile, readLockfile } from "../core/lockfile.js";
import { getDevInstallPath, loadManifestOrThrow } from "../core/manifest.js";
import { getGlobalDir, getGlobalInstallBase } from "../core/paths.js";
import { pc, warn } from "../core/ui.js";

export interface VerifyOptions {
	global?: boolean;
	globalDir?: string; // test override
	json?: boolean;
}

export async function verifyCommand(dir: string, opts?: VerifyOptions): Promise<void> {
	const isGlobal = !!opts?.global;
	const globalDir = opts?.globalDir ?? getGlobalDir();

	const manifest = await loadManifestOrThrow(dir, { global: isGlobal, globalDir });
	const lockfile = isGlobal ? await readGlobalLockfile(globalDir) : await readLockfile(dir);
	const installBase = isGlobal ? getGlobalInstallBase() : join(dir, getDevInstallPath(manifest));

	if (!lockfile) {
		const cmd = isGlobal ? "skilltree install --global" : "skilltree install";
		throw new Error(`No lockfile found. Run \`${cmd}\` first.`);
	}

	const result = await resolveAll(manifest, isGlobal ? globalDir : dir);

	const integrityMap: Record<string, string> = {};
	for (const [key, entry] of Object.entries(lockfile.packages)) {
		if (entry.integrity) {
			integrityMap[key] = entry.integrity;
		}
	}

	const statuses = await verifyInstalled(
		result.entities,
		installBase,
		integrityMap,
		isGlobal ? globalDir : dir,
	);

	if (opts?.json) {
		// Machine-readable shape: array of {name, status}. No diagnostics, no
		// colors — consumers branch on `status` themselves.
		console.log(JSON.stringify(statuses, null, 2));
		return;
	}

	for (const status of statuses) {
		console.log(`  ${status.name.padEnd(25)} ${formatStatusIcon(status.status)}`);
	}

	printVerifyDiagnostics(statuses, isGlobal);
}

function formatStatusIcon(status: VerifyStatus): string {
	switch (status) {
		case "ok":
			return pc.green("OK");
		case "linked":
			return pc.blue("LINKED");
		case "modified":
			return pc.yellow("MODIFIED");
		case "stale":
			return pc.yellow("STALE");
		case "broken":
			return pc.red("BROKEN");
		case "missing":
			return pc.red("MISSING");
	}
}

function printVerifyDiagnostics(
	statuses: Array<{ name: string; status: VerifyStatus }>,
	isGlobal: boolean,
): void {
	const modified = statuses.filter((s) => s.status === "modified");
	const missing = statuses.filter((s) => s.status === "missing");
	const broken = statuses.filter((s) => s.status === "broken");
	const stale = statuses.filter((s) => s.status === "stale");

	if (modified.length === 0 && missing.length === 0 && broken.length === 0 && stale.length === 0) {
		return;
	}

	const installCmd = isGlobal ? "skilltree install --global" : "skilltree install";
	if (modified.length > 0) {
		warn(
			`${modified.length} entity has local modifications. Run ${pc.cyan(`\`${installCmd} --force\``)} to overwrite.`,
		);
	}
	if (missing.length > 0) {
		warn(`${missing.length} entity is missing. Run ${pc.cyan(`\`${installCmd}\``)} to restore.`);
	}
	if (broken.length > 0) {
		warn(
			`${broken.length} symlink is broken. Check source paths in ${isGlobal ? GLOBAL_MANIFEST : MANIFEST_NEW}.`,
		);
	}
	if (stale.length > 0) {
		warn(`${stale.length} vendored copy is stale. Run ${pc.cyan("`skilltree vendor`")} to update.`);
	}
}
