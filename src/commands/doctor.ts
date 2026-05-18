// `skilltree doctor` — preflight health check (issue #84, Nitrogen).
//
// Phase 2 shipped text mode + exit codes + acceptance criteria 1–3.
// Phase 3 adds --json, --global, and the real registry-reachability
// check (with a 5s git ls-remote timeout). The read-only invariant is
// asserted by test fixtures in `tests/commands/doctor.test.ts`.
//
// Spec: docs/specs/doctor.md.

import { type LsRemoteOutcome, lsRemote } from "../core/git.js";
import { diffManifestLockfile, readLockfile } from "../core/lockfile.js";
import { loadManifestOrThrow, validateGlobalManifest, validateManifest } from "../core/manifest.js";
import { listRegistries } from "../core/registry-config.js";
import { dim, pc } from "../core/ui.js";
import type { CheckResult, CheckStatus, CheckSummary, Manifest } from "../types.js";
import { collectCheckIssues } from "./check.js";
import { resolveTargets } from "./targets.js";

/**
 * Probe used by the registry-reachability check. Tests inject a synchronous
 * mock so they never hit the network; production uses `lsRemote` from
 * `src/core/git.ts`. Spec D9.
 */
export type ReachabilityProbe = (url: string) => Promise<LsRemoteOutcome>;

export interface DoctorOptions {
	/** Emit JSON instead of the human-readable text table. Spec D2. */
	json?: boolean;
	/** Run against the global manifest. Skips lockfile + target-consistency. Spec D2. */
	global?: boolean;
	/** Override path to the global manifest directory (testing). */
	globalDir?: string;
	/** Override path to the registries config file (testing). */
	registryConfigPath?: string;
	/** Override the network probe (testing). */
	probe?: ReachabilityProbe;
}

export interface DoctorReport {
	checks: CheckResult[];
	summary: Record<CheckStatus, number>;
}

/**
 * Pure orchestrator. Runs every check and returns the structured report.
 * No printing, no `process.exit`. Tests call this directly.
 *
 * Each check is wrapped so an unexpected exception inside one check becomes
 * a `fail` row instead of aborting the whole command (spec error-handling).
 */
export async function runDoctor(dir: string, opts: DoctorOptions = {}): Promise<DoctorReport> {
	const isGlobal = opts.global === true;
	const probe = opts.probe ?? lsRemote;

	let manifest: Manifest | null = null;
	let manifestLoadError: string | undefined;
	try {
		manifest = await loadManifestOrThrow(dir, { global: isGlobal, globalDir: opts.globalDir });
	} catch (err) {
		manifestLoadError = err instanceof Error ? err.message : String(err);
	}

	const checks: CheckResult[] = [];
	checks.push(checkManifestSchema(manifest, manifestLoadError, isGlobal));

	// Single `collectCheckIssues` call; share its result between the lint and
	// frontmatter rows. Both rows summarize different facets of the same scan.
	let summary: CheckSummary | undefined;
	let lintError: string | undefined;
	if (manifest) {
		try {
			summary = await collectCheckIssues(manifest, dir);
		} catch (err) {
			lintError = err instanceof Error ? err.message : String(err);
		}
	}

	checks.push(checkLint(summary, lintError, manifest));
	checks.push(await checkLockfileSync(manifest, dir, isGlobal));
	checks.push(await checkTargetConsistency(manifest, isGlobal));
	checks.push(await checkRegistryReachability(probe, opts.registryConfigPath));
	checks.push(checkFrontmatter(summary, lintError, manifest));

	return { checks, summary: tallyStatuses(checks) };
}

/**
 * CLI wrapper. Calls `runDoctor`, renders to stdout (text or JSON), then
 * exits 1 if any check failed. Warnings do NOT affect exit code (spec D20–D21).
 * Exit codes are identical between text and JSON modes (spec D22).
 */
export async function doctorCommand(dir: string, opts: DoctorOptions = {}): Promise<void> {
	const report = await runDoctor(dir, opts);
	if (opts.json) {
		renderDoctorJson(report);
	} else {
		renderDoctor(report);
	}
	if (report.summary.fail > 0) {
		process.exit(1);
	}
}

// ---------------------------------------------------------------------------
// Per-check implementations
// ---------------------------------------------------------------------------

function countDeclaredDeps(manifest: Manifest): number {
	return (
		Object.keys(manifest.dependencies ?? {}).length +
		Object.keys(manifest["dev-dependencies"] ?? {}).length
	);
}

function checkManifestSchema(
	manifest: Manifest | null,
	loadError: string | undefined,
	isGlobal: boolean,
): CheckResult {
	if (loadError !== undefined) {
		return { name: "manifest-schema", status: "fail", detail: loadError };
	}
	if (!manifest) {
		return { name: "manifest-schema", status: "fail", detail: "manifest is empty" };
	}
	const errors = isGlobal ? validateGlobalManifest(manifest) : validateManifest(manifest);
	if (errors.length === 0) {
		return { name: "manifest-schema", status: "pass" };
	}
	return { name: "manifest-schema", status: "fail", detail: errors.join("; ") };
}

function checkLint(
	summary: CheckSummary | undefined,
	lintError: string | undefined,
	manifest: Manifest | null,
): CheckResult {
	if (!manifest) {
		return { name: "lint", status: "skip", detail: "no manifest" };
	}
	if (lintError !== undefined) {
		return { name: "lint", status: "fail", detail: lintError };
	}
	if (!summary) {
		return { name: "lint", status: "skip", detail: "lint did not run" };
	}
	const count = summary.lint.length + summary.frontmatterWarnings.length;
	if (count === 0) {
		return { name: "lint", status: "pass" };
	}
	return {
		name: "lint",
		status: "fail",
		detail: `${count} issue${count === 1 ? "" : "s"} found`,
		fix: "Run `skilltree check` for details",
	};
}

async function checkLockfileSync(
	manifest: Manifest | null,
	dir: string,
	isGlobal: boolean,
): Promise<CheckResult> {
	if (isGlobal) {
		return { name: "lockfile-sync", status: "skip", detail: "global mode" };
	}
	if (!manifest) {
		return { name: "lockfile-sync", status: "skip", detail: "no manifest" };
	}
	// Vacuous pass: with zero declared deps there's nothing to lock, so the
	// absence of a lockfile is not a problem. Without this guard the canonical
	// `init && doctor` flow returns exit 1 on a brand-new project (issue #121).
	if (countDeclaredDeps(manifest) === 0) {
		return { name: "lockfile-sync", status: "pass", detail: "no dependencies declared" };
	}
	try {
		const lockfile = await readLockfile(dir);
		if (!lockfile) {
			return {
				name: "lockfile-sync",
				status: "fail",
				detail: "no skilltree.lock found",
				fix: "Run `skilltree install` to sync",
			};
		}
		const diff = diffManifestLockfile(manifest, lockfile);
		const added = diff.added.length;
		const removed = diff.removed.length;
		const changed = diff.changed.length;
		if (added + removed + changed === 0) {
			return { name: "lockfile-sync", status: "pass" };
		}
		const parts: string[] = [];
		if (added > 0) parts.push(`${added} added (${diff.added.slice(0, 3).join(", ")})`);
		if (removed > 0) parts.push(`${removed} removed (${diff.removed.slice(0, 3).join(", ")})`);
		if (changed > 0) parts.push(`${changed} changed (${diff.changed.slice(0, 3).join(", ")})`);
		return {
			name: "lockfile-sync",
			status: "fail",
			detail: parts.join("; "),
			fix: "Run `skilltree install` to sync",
		};
	} catch (err) {
		return {
			name: "lockfile-sync",
			status: "fail",
			detail: err instanceof Error ? err.message : String(err),
		};
	}
}

async function checkTargetConsistency(
	manifest: Manifest | null,
	isGlobal: boolean,
): Promise<CheckResult> {
	if (isGlobal) {
		return { name: "target-consistency", status: "skip", detail: "global mode" };
	}
	if (!manifest) {
		return { name: "target-consistency", status: "skip", detail: "no manifest" };
	}
	const targets = manifest.install_targets ?? [];
	if (targets.length === 0) {
		// Vacuously passes: nothing to resolve, nothing to break.
		return { name: "target-consistency", status: "pass" };
	}
	try {
		const resolved = await resolveTargets(targets);
		const failed = resolved.filter((r) => !r.ok);
		if (failed.length === 0) {
			return { name: "target-consistency", status: "pass" };
		}
		const first = failed[0];
		return {
			name: "target-consistency",
			status: "fail",
			detail: `${failed.length} unresolved (${first?.target}: ${first?.error})`,
			fix: "Check install_targets in skilltree.yml",
		};
	} catch (err) {
		return {
			name: "target-consistency",
			status: "fail",
			detail: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Spec D9: `git ls-remote` each configured registry with a 5s timeout.
 * Warns (never fails) on unreachable / auth-required / timeout — the user
 * may be offline or on a registry that requires SSH keys they haven't set
 * up, and neither blocks publishing.
 *
 * `--global` mode still runs this check: registries live in
 * `~/.skilltree/config.yaml` regardless of the manifest scope.
 */
async function checkRegistryReachability(
	probe: ReachabilityProbe,
	configPath: string | undefined,
): Promise<CheckResult> {
	try {
		const registries = await listRegistries(configPath);
		if (registries.length === 0) {
			return {
				name: "registry-reachability",
				status: "pass",
				detail: "no registries configured",
			};
		}
		const warnings: string[] = [];
		for (const reg of registries) {
			const outcome = await probe(reg.repo);
			if (!outcome.ok) {
				warnings.push(`${reg.name} (${outcome.reason})`);
			}
		}
		if (warnings.length === 0) {
			return { name: "registry-reachability", status: "pass" };
		}
		return {
			name: "registry-reachability",
			status: "warn",
			detail: warnings.join(", "),
		};
	} catch (err) {
		return {
			name: "registry-reachability",
			status: "fail",
			detail: err instanceof Error ? err.message : String(err),
		};
	}
}

function checkFrontmatter(
	summary: CheckSummary | undefined,
	lintError: string | undefined,
	manifest: Manifest | null,
): CheckResult {
	if (!manifest) {
		return { name: "frontmatter", status: "skip", detail: "no manifest" };
	}
	if (lintError !== undefined) {
		// The lint row already reported it; mirror as skip so the count stays
		// honest and we don't double-charge.
		return { name: "frontmatter", status: "skip", detail: "see lint failure" };
	}
	if (!summary) {
		return { name: "frontmatter", status: "skip", detail: "lint did not run" };
	}
	const w = summary.frontmatterWarnings.length;
	if (w === 0) {
		return { name: "frontmatter", status: "pass" };
	}
	return {
		name: "frontmatter",
		status: "fail",
		detail: `${w} frontmatter issue${w === 1 ? "" : "s"}`,
		fix: "Run `skilltree check` for details",
	};
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function tallyStatuses(checks: CheckResult[]): Record<CheckStatus, number> {
	const t: Record<CheckStatus, number> = { pass: 0, fail: 0, warn: 0, skip: 0 };
	for (const c of checks) t[c.status]++;
	return t;
}

const STATUS_GLYPH: Record<CheckStatus, string> = {
	pass: "✔",
	fail: "✘",
	warn: "⚠",
	skip: "–",
};

/** Color the status glyph per spec D12; leave the surrounding text uncolored. */
function colorGlyph(status: CheckStatus): string {
	const g = STATUS_GLYPH[status];
	switch (status) {
		case "pass":
			return pc.green(g);
		case "fail":
			return pc.red(g);
		case "warn":
			return pc.yellow(g);
		case "skip":
			return dim(g);
	}
}

// Left-column width: longest check name we render. Computed once at module
// load to keep the renderer allocation-free per call.
const CHECK_NAME_WIDTH = 24;

/**
 * Render the report to stdout. One row per check, plus an indented `→ fix`
 * line under any failure that supplies a `fix` string. Footer summarizes
 * pass/fail/warn counts per spec D14.
 *
 * Exported for tests that want to render a synthetic report without
 * running `runDoctor`.
 */
export function renderDoctor(report: DoctorReport): void {
	for (const check of report.checks) {
		const glyph = colorGlyph(check.status);
		const detail = check.detail
			? `  ${check.status === "fail" ? pc.red(check.detail) : check.status === "warn" ? pc.yellow(check.detail) : dim(check.detail)}`
			: "";
		console.log(`${check.name.padEnd(CHECK_NAME_WIDTH)}${glyph}${detail}`);
		if (check.status === "fail" && check.fix) {
			// Indent below the glyph column for readability.
			console.log(`${" ".repeat(CHECK_NAME_WIDTH + 2)}${dim(`→ ${check.fix}`)}`);
		}
	}
	console.log("");
	const { pass, fail, warn, skip } = report.summary;
	if (fail === 0 && warn === 0) {
		console.log(
			pc.green(`✔ doctor: all ${pass} checks passed${skip > 0 ? ` (${skip} skipped)` : ""}`),
		);
		return;
	}
	const parts: string[] = [];
	if (fail > 0) parts.push(`${fail} failure${fail === 1 ? "" : "s"}`);
	if (warn > 0) parts.push(`${warn} warning${warn === 1 ? "" : "s"}`);
	const summary = parts.join(", ");
	const glyph = fail > 0 ? pc.red("✘") : pc.yellow("⚠");
	console.log(`${glyph} doctor: ${summary}`);
}

/**
 * Render the report as JSON per spec D16–D19. Stable kebab-case `name`
 * values; `detail` / `fix` omitted when absent. Exit codes identical to
 * text mode (spec D22) — this function only writes; the caller (CLI)
 * sets the exit.
 *
 * `JSON.stringify` naturally omits `undefined` fields, satisfying D19
 * without per-field tweaking.
 */
export function renderDoctorJson(report: DoctorReport): void {
	console.log(JSON.stringify(report, null, 2));
}
