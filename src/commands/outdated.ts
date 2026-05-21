import semver from "semver";
import { MANIFEST_NEW, manifestExists } from "../core/filenames.js";
import { ensureCached, listTags } from "../core/git.js";
import { readGlobalLockfile, readLockfile } from "../core/lockfile.js";
import { expandSources, readGlobalManifest, readManifest } from "../core/manifest.js";
import { getGlobalDir } from "../core/paths.js";
import { filterSemverTags, findCappingSiblings } from "../core/resolver.js";
import { type ColumnDef, dim, pc, printTable } from "../core/ui.js";
import {
	type EntityType,
	isRemoteDependency,
	isSourceDependency,
	type LockfileEntry,
	type Manifest,
} from "../types.js";

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
	/**
	 * Sibling constraints in the same repo that prevent this dep from
	 * reaching `latest` even though its own constraint would allow it (#136).
	 * Null when no cap applies or when the dep's own constraint already
	 * excludes `latest`.
	 */
	cappedBy: string[] | null;
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

	// Read the manifest to attribute capping sibling constraints (#136). The
	// lockfile alone doesn't carry constraint info — only the manifest does.
	// A missing/unparsable manifest is non-fatal: rows just won't carry cap
	// annotations.
	const constraintsByRepo = await readConstraintsByRepo(isGlobal, dir, globalDir);

	// Resolve rows in parallel — each row hits a different repo cache, and
	// the network roundtrip dominates per-row work.
	const rows = await Promise.all(
		entries.map(([key, entry]) => buildRow(key, entry, constraintsByRepo)),
	);

	if (opts?.json) {
		console.log(JSON.stringify(rows, null, 2));
	} else {
		printOutdatedTable(rows);
	}

	if (opts?.check && rows.some((r) => r.bump !== null)) {
		// Setting process.exitCode (rather than calling process.exit) lets the
		// process flush stdout/stderr naturally before exiting — important
		// since we just printed the table or JSON the user wants to see.
		process.exitCode = 1;
	}
}

async function buildRow(
	key: string,
	entry: LockfileEntry,
	constraintsByRepo: ConstraintsByRepo,
): Promise<OutdatedRow> {
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
			cappedBy: null,
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
		return {
			name,
			type,
			current,
			currentCommit,
			latest: null,
			bump: null,
			repo: null,
			cappedBy: null,
		};
	}

	let tags: string[];
	try {
		const cachePath = await ensureCached(repo);
		tags = await listTags(cachePath);
	} catch {
		return {
			name,
			type,
			current,
			currentCommit,
			latest: null,
			bump: "error",
			repo,
			cappedBy: null,
		};
	}

	const semverTags = filterSemverTags(tags);
	// filterSemverTags returns rcompare-sorted, so [0] is the highest version.
	// Empty array → no tags at all → no upstream signal.
	const latest = semverTags[0]?.version;
	if (!latest) {
		return { name, type, current, currentCommit, latest: null, bump: null, repo, cappedBy: null };
	}

	const currentSemver = entry.version;
	if (!currentSemver) {
		// Commit-only resolution: we can surface the latest tag for context
		// but can't compute a bump kind without a semver anchor on the
		// current side. Matches the example in the issue body where
		// `task-builder @a56045e | 2.0.0 | —` shows "—".
		return { name, type, current, currentCommit, latest, bump: null, repo, cappedBy: null };
	}

	if (semver.eq(currentSemver, latest)) {
		return { name, type, current, currentCommit, latest, bump: null, repo, cappedBy: null };
	}

	const bump = classifyBump(currentSemver, latest);
	const cappedBy = computeCappedBy(repo, name, latest, constraintsByRepo);
	return { name, type, current, currentCommit, latest, bump, repo, cappedBy };
}

type ConstraintsByRepo = Map<string, Array<{ name: string; constraint: string }>>;

/**
 * Build a per-repo index of `(name, constraint)` pairs from the project (or
 * global) manifest, used to compute `cappedBy` annotations (#136). Reads
 * both prod and dev dependencies; sources are pre-expanded so remote +
 * source deps both end up keyed by their underlying `repo` URL. Pack
 * references are skipped — their member constraints live upstream and
 * aren't reachable through the consumer manifest alone.
 *
 * Errors are swallowed: a missing/malformed manifest means no annotations,
 * not a crashed `outdated` run.
 */
async function readConstraintsByRepo(
	isGlobal: boolean,
	dir: string,
	globalDir: string,
): Promise<ConstraintsByRepo> {
	let manifest: Manifest;
	try {
		const raw = isGlobal ? await readGlobalManifest(globalDir) : await readManifest(dir);
		manifest = expandSources(raw);
	} catch {
		return new Map();
	}

	const result: ConstraintsByRepo = new Map();
	for (const group of [manifest.dependencies, manifest["dev-dependencies"]]) {
		if (!group) continue;
		for (const [name, dep] of Object.entries(group)) {
			// Source deps are flattened to repo form by expandSources, but the
			// guard pair is kept for forward-compat against future shapes.
			if (!isRemoteDependency(dep) && !isSourceDependency(dep)) continue;
			const repo = "repo" in dep ? dep.repo : undefined;
			if (repo === undefined) continue;
			const constraint = dep.version ?? "*";
			const list = result.get(repo) ?? [];
			list.push({ name, constraint });
			result.set(repo, list);
		}
	}
	return result;
}

/**
 * Compute the `cappedBy` list for a single row. Returns the formatted
 * sibling constraint strings (e.g. `["tut@^0.5.0"]`) only when:
 *  1. The dep's own constraint accepts `latest` (otherwise the cap is
 *     self-imposed and not interesting to annotate).
 *  2. At least one sibling in the same repo carries a tighter constraint
 *     that excludes `latest`.
 *
 * Returns `null` otherwise. A `null` result also covers the edge case where
 * the manifest doesn't list this dep (e.g. it was removed but the lockfile
 * still has the entry).
 */
function computeCappedBy(
	repo: string,
	name: string,
	latest: string,
	constraintsByRepo: ConstraintsByRepo,
): string[] | null {
	const siblings = constraintsByRepo.get(repo);
	if (siblings === undefined) return null;

	const self = siblings.find((s) => s.name === name);
	if (self !== undefined && self.constraint !== "*" && !semver.satisfies(latest, self.constraint)) {
		return null;
	}

	const capped = findCappingSiblings(siblings, latest, name);
	return capped.length > 0 ? capped : null;
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

/** Em-dash placeholder used in the human-facing table for null `latest`/`bump`. */
const EMDASH = "—";

interface DisplayRow {
	name: string;
	current: string;
	latest: string;
	bump: string;
	notes: string;
}

const OUTDATED_COLUMNS: ColumnDef<DisplayRow>[] = [
	{ header: "Name", value: (r) => r.name, color: pc.cyan },
	{ header: "Current", value: (r) => r.current },
	{ header: "Latest", value: (r) => r.latest, color: pc.green },
	{ header: "Bump", value: (r) => r.bump, color: colorBump },
	{ header: "Notes", value: (r) => r.notes, color: dim },
];

function printOutdatedTable(rows: OutdatedRow[]): void {
	const display: DisplayRow[] = rows.map((r) => ({
		name: r.name,
		current: r.current,
		latest: r.latest ?? EMDASH,
		bump: r.bump ?? EMDASH,
		notes: r.cappedBy ? `capped by ${r.cappedBy.join(", ")}` : "",
	}));
	// Drop the Notes column entirely when no row has anything to say — keeps
	// the simple `outdated` table from growing a useless trailing column.
	const columns = display.some((r) => r.notes !== "")
		? OUTDATED_COLUMNS
		: OUTDATED_COLUMNS.filter((c) => c.header !== "Notes");
	printTable(display, columns);
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
