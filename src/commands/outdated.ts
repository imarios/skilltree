import semver from "semver";
import { MANIFEST_NEW, manifestExists } from "../core/filenames.js";
import { ensureCached, listTags } from "../core/git.js";
import { readGlobalLockfile, readLockfile } from "../core/lockfile.js";
import { getGlobalDir } from "../core/paths.js";
import { filterSemverTags } from "../core/resolver.js";
import { dim, pc } from "../core/ui.js";
import type { EntityType, LockfileEntry } from "../types.js";

export interface OutdatedOptions {
	json?: boolean;
	check?: boolean;
	global?: boolean;
	/** Test override — defaults to `getGlobalDir()`. */
	globalDir?: string;
}

export type BumpKind = "major" | "minor" | "patch" | "error" | null;

export interface OutdatedRow {
	name: string;
	type: EntityType;
	/** Display form: semver string, `@<short-sha>`, or `local`. */
	current: string;
	/** The resolved commit SHA, or null for local deps. */
	currentCommit: string | null;
	/** Latest semver tag on the resolved repo, or null when unknown. */
	latest: string | null;
	/** Upgrade magnitude. null for local/up-to-date/commit-only. "error" on network failure. */
	bump: BumpKind;
	/** The repo URL, or null for local deps. */
	repo: string | null;
}

/**
 * `skilltree outdated` — read-only preview of dependency drift.
 *
 * Reads manifest + lockfile and reports which deps have newer semver tags
 * available upstream. Never writes the lockfile or manifest; the registry
 * cache may still be fetched (that's not project state). Mirrors the
 * affordance pattern of `npm outdated` / `cargo outdated`. See issue #79.
 */
export async function outdatedCommand(
	dir: string,
	name?: string,
	opts?: OutdatedOptions,
): Promise<void> {
	const isGlobal = !!opts?.global;
	const globalDir = opts?.globalDir ?? getGlobalDir();

	if (!isGlobal && !manifestExists(dir)) {
		throw new Error(`No ${MANIFEST_NEW} found. Run \`skilltree init\` first.`);
	}

	const lockfile = isGlobal ? await readGlobalLockfile(globalDir) : await readLockfile(dir);

	if (!lockfile || Object.keys(lockfile.packages).length === 0) {
		if (opts?.json) {
			console.log("[]");
			return;
		}
		console.log(
			isGlobal
				? "No global dependencies installed. Run `skilltree install --global`."
				: "No dependencies installed. Run `skilltree install`.",
		);
		return;
	}

	let entries = Object.entries(lockfile.packages);
	if (name) {
		const filtered = entries.filter(([key, entry]) => (entry.name ?? key) === name);
		if (filtered.length === 0) {
			throw new Error(`"${name}" is not in the lockfile.`);
		}
		entries = filtered;
	}

	// Resolve rows in parallel — each row hits a different repo cache, and
	// the network roundtrip dominates per-row work.
	const rows = await Promise.all(entries.map(([key, entry]) => buildRow(key, entry)));

	if (opts?.json) {
		console.log(JSON.stringify(rows, null, 2));
	} else {
		printTable(rows);
	}

	if (opts?.check && rows.some((r) => r.bump !== null)) {
		// Setting process.exitCode (rather than calling process.exit) lets the
		// process flush stdout/stderr naturally before exiting — important
		// since we just printed the table or JSON the user wants to see.
		process.exitCode = 1;
	}
}

async function buildRow(key: string, entry: LockfileEntry): Promise<OutdatedRow> {
	const name = entry.name ?? key;
	const type = entry.type;

	if (entry.source === "local") {
		return {
			name,
			type,
			current: "local",
			currentCommit: null,
			latest: null,
			bump: null,
			repo: null,
		};
	}

	const repo = entry.repo ?? null;
	// Treat "" and null/undefined as "no commit" — empty-string-vs-undefined
	// has bitten this codebase before (see CLAUDE.md hardening pattern #2).
	const commit = entry.commit ? entry.commit : null;
	const current = entry.version ?? (commit ? `@${commit.slice(0, 7)}` : "-");
	const currentCommit = commit;

	if (!repo) {
		// Defensive: a non-local entry without a repo URL is malformed but
		// shouldn't crash a read-only command — report and move on.
		return { name, type, current, currentCommit, latest: null, bump: null, repo: null };
	}

	let tags: string[];
	try {
		const cachePath = await ensureCached(repo);
		tags = await listTags(cachePath);
	} catch {
		return { name, type, current, currentCommit, latest: null, bump: "error", repo };
	}

	const semverTags = filterSemverTags(tags);
	// filterSemverTags returns rcompare-sorted, so [0] is the highest version.
	// Empty array → no tags at all → no upstream signal.
	const latest = semverTags[0]?.version;
	if (!latest) {
		return { name, type, current, currentCommit, latest: null, bump: null, repo };
	}

	const currentSemver = entry.version;
	if (!currentSemver) {
		// Commit-only resolution: we can surface the latest tag for context
		// but can't compute a bump kind without a semver anchor on the
		// current side. Matches the example in the issue body where
		// `task-builder @a56045e | 2.0.0 | —` shows "—".
		return { name, type, current, currentCommit, latest, bump: null, repo };
	}

	if (semver.eq(currentSemver, latest)) {
		return { name, type, current, currentCommit, latest, bump: null, repo };
	}

	const bump = classifyBump(currentSemver, latest);
	return { name, type, current, currentCommit, latest, bump, repo };
}

/**
 * Reduce semver.diff's seven-way output (major, premajor, minor, preminor,
 * patch, prepatch, prerelease) to the three buckets the UI reports.
 *
 * Returns null when semver.diff can't classify the change (e.g.
 * build-metadata-only differences). That's read-only-safe: it keeps the
 * row visible but does NOT trigger `--check` exit-1, since we have no
 * meaningful upgrade to recommend.
 */
function classifyBump(current: string, latest: string): "major" | "minor" | "patch" | null {
	const diff = semver.diff(current, latest);
	if (!diff) return null;
	if (diff === "major" || diff === "premajor") return "major";
	if (diff === "minor" || diff === "preminor") return "minor";
	return "patch";
}

function printTable(rows: OutdatedRow[]): void {
	const display = rows.map((r) => ({
		name: r.name,
		current: r.current,
		latest: r.latest ?? "—",
		bump: r.bump ?? "—",
	}));

	const widths = {
		name: Math.max(4, ...display.map((r) => r.name.length)),
		current: Math.max(7, ...display.map((r) => r.current.length)),
		latest: Math.max(6, ...display.map((r) => r.latest.length)),
		bump: Math.max(4, ...display.map((r) => r.bump.length)),
	};

	console.log(
		pc.bold(
			`${"Name".padEnd(widths.name)}  ${"Current".padEnd(widths.current)}  ${"Latest".padEnd(widths.latest)}  Bump`,
		),
	);
	console.log(dim("-".repeat(widths.name + widths.current + widths.latest + widths.bump + 6)));
	for (const row of display) {
		console.log(
			`${pc.cyan(row.name.padEnd(widths.name))}  ${row.current.padEnd(widths.current)}  ${pc.green(row.latest.padEnd(widths.latest))}  ${colorBump(row.bump)}`,
		);
	}
}

function colorBump(bump: string): string {
	switch (bump) {
		case "major":
			return pc.red(bump);
		case "minor":
			return pc.yellow(bump);
		case "patch":
			return pc.green(bump);
		case "error":
			return pc.red(bump);
		default:
			return dim(bump);
	}
}
