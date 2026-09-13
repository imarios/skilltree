import { join } from "node:path";
import { GLOBAL_MANIFEST, MANIFEST_NEW } from "../core/filenames.js";
import { resolveAll } from "../core/graph.js";
import type { VerifyStatus } from "../core/installer.js";
import { verifyInstalled } from "../core/installer.js";
import { readGlobalLockfile, readLockfile } from "../core/lockfile.js";
import { getDevInstallPath, loadManifestOrThrow, resolveInstallBases } from "../core/manifest.js";
import { getGlobalDir, getGlobalInstallBase } from "../core/paths.js";
import { findExtraneous } from "../core/prune.js";
import { pc, warn } from "../core/ui.js";

export interface VerifyOptions {
	global?: boolean;
	globalDir?: string; // test override
	json?: boolean;
	strict?: boolean;
}

/**
 * Statuses that mean the install no longer matches the lockfile.
 *
 * `ok` and `linked` are both healthy — `linked` is the normal steady state
 * for a local dependency, so gating on "not ok" would fail every project
 * that develops a skill in-tree. This is the single definition of drift:
 * both the `--strict` gate and the diagnostics footer read from it, so a
 * future status can't be added to one and forgotten in the other.
 *
 * Exported for `doctor`'s `install-drift` check (#187), which asks the same
 * question and must not answer it with a second copy of this list.
 */
export const DRIFT_STATUSES: ReadonlySet<VerifyStatus> = new Set<VerifyStatus>([
	"modified",
	"missing",
	"broken",
	"stale",
]);

function hasDrift(statuses: Array<{ status: VerifyStatus }>): boolean {
	return statuses.some((s) => DRIFT_STATUSES.has(s.status));
}

export async function verifyCommand(dir: string, opts?: VerifyOptions): Promise<void> {
	const isGlobal = !!opts?.global;
	const globalDir = opts?.globalDir ?? getGlobalDir();
	const strict = opts?.strict === true;

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

	// Entries on disk that skilltree didn't install (#205). Listed so they are
	// visible, but kept out of the drift verdict below: a hand-placed skill is
	// legitimate, and `--strict` must not fail on it.
	const extraneous = await findExtraneous(lockfile, resolveInstallBases(manifest, dir, isGlobal));
	const rows: Array<{ name: string; status: VerifyStatus }> = [
		...statuses,
		...extraneous.map((entry) => ({ name: entry.name, status: "extraneous" as const })),
	];

	// Resolution errors are drift too. An entity that fails to resolve — a
	// `local:` path that no longer exists (#207) — is absent from
	// `result.entities`, so it never reaches `verifyInstalled` and would
	// otherwise drop out of this report without a word. Every other
	// `resolveAll` caller already acts on these; `verify` was the one that
	// silently discarded them.
	const resolutionErrors = result.errors;
	const drifted = hasDrift(statuses) || resolutionErrors.length > 0;

	if (opts?.json) {
		// Machine-readable shape: array of {name, status}. No diagnostics, no
		// colors, and no --strict footer — the output stays a single parseable
		// document, and the exit code carries the verdict instead.
		console.log(JSON.stringify(rows, null, 2));
	} else {
		for (const status of rows) {
			console.log(`  ${status.name.padEnd(25)} ${formatStatusIcon(status.status)}`);
		}

		printVerifyDiagnostics(statuses, isGlobal);
		printExtraneous(extraneous);
		for (const message of resolutionErrors) {
			warn(message);
		}

		if (drifted) {
			// Same shape as `check`'s verdict line (#172): under --strict the run
			// has already failed, so repeating the flag the caller just passed
			// would read as advisory.
			console.log(
				pc.dim(
					strict
						? "Failing because --strict is set."
						: "Re-run with --strict to fail the command on drift.",
				),
			);
		}
	}

	if (drifted && strict) {
		// Setting process.exitCode (rather than calling process.exit) lets the
		// process flush stdout naturally — we just printed the table or the JSON
		// the caller wants to read. Matches `outdated --check`.
		process.exitCode = 1;
	}
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
		case "extraneous":
			return pc.yellow("EXTRANEOUS");
	}
}

function printVerifyDiagnostics(
	statuses: Array<{ name: string; status: VerifyStatus }>,
	isGlobal: boolean,
): void {
	if (!hasDrift(statuses)) {
		return;
	}

	const modified = statuses.filter((s) => s.status === "modified");
	const missing = statuses.filter((s) => s.status === "missing");
	const broken = statuses.filter((s) => s.status === "broken");
	const stale = statuses.filter((s) => s.status === "stale");

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

function printExtraneous(extraneous: Array<{ name: string; path: string }>): void {
	if (extraneous.length === 0) return;
	const one = extraneous.length === 1;
	warn(
		`${extraneous.length} ${one ? "entry" : "entries"} in the install tree ${one ? "was" : "were"} not installed by skilltree: ${extraneous.map((entry) => entry.path).join(", ")}. skilltree leaves ${one ? "it" : "them"} alone; remove ${one ? "it" : "them"} by hand if you no longer need ${one ? "it" : "them"}.`,
	);
}
