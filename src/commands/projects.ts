import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { LOCKFILE_NEW, MANIFEST_NEW, MANIFEST_NEW_ALT } from "../core/filenames.js";
import { parseManifest } from "../core/manifest.js";
import { collapseTilde } from "../core/paths.js";
import { type ColumnDef, dim, pc, printTable, warn } from "../core/ui.js";

/**
 * `skilltree projects` — read-only inventory of skilltree-managed projects
 * discoverable on this machine. See issue #81.
 *
 * Walks the filesystem from `--root` (default `$HOME`) and reports any
 * directory that contains a manifest. Never writes; safe to run anytime.
 */
export interface ProjectsOptions {
	root?: string;
	json?: boolean;
}

export interface ProjectRow {
	/** Absolute path to the project directory. */
	path: string;
	/** Absolute path to the manifest file that anchored the project. */
	manifestPath: string;
	/** Combined count of `dependencies` + `dev-dependencies`. */
	deps: number;
	/** True iff `vendor: true` in the manifest. */
	vendor: boolean;
	/** mtime of `skilltree.lock` as ISO-8601, or null when no lockfile. */
	lastInstall: string | null;
}

// Directory names we never descend into. `.git` and `node_modules` dominate
// real-world walk time; `dist`/`build` keep us out of generated trees that
// occasionally contain copied manifests; `.skilltree/cache` would otherwise
// surface cached registry repos as "projects" (they aren't).
const SKIP_DIR_NAMES = new Set(["node_modules", ".git", "dist", "build"]);

// Hidden directories (leading `.`) are skipped EXCEPT this allowlist.
// `.claude` is where most skilltree projects live in practice, so dropping it
// would make the command almost useless on a typical dev machine.
const ALLOWED_HIDDEN_DIRS = new Set([".claude"]);

// Path suffix (relative to root) that must be skipped. We can't catch it via
// the name-only `SKIP_DIR_NAMES` set because `.skilltree` itself is fine to
// descend (it might one day hold non-cache state) — only `.skilltree/cache`
// is the dead end.
const SKIP_REL_SUFFIXES = ["/.skilltree/cache"];

/**
 * Resolve `--root`, walk it, then render. The walker collects rows + a list
 * of unparseable manifest paths so we can emit a single warning per path
 * (the issue body asks for "a single dim warning per skipped path"); printing
 * inside the walker would make ordering non-deterministic with concurrent
 * `readdir` work.
 */
export async function projectsCommand(opts?: ProjectsOptions): Promise<void> {
	const root = opts?.root ?? homedir();

	const projects: ProjectRow[] = [];
	const parseFailures: string[] = [];
	// (dev,ino) of directories we've already entered — protects against
	// symlink cycles (a -> b -> a) and the kind of hard-link weirdness that
	// occasionally shows up on shared NFS mounts.
	const visited = new Set<string>();

	let rootDev: number | null = null;
	try {
		const rootStat = await stat(root);
		rootDev = rootStat.dev;
	} catch {
		// Root doesn't exist or isn't accessible — render an empty result.
		// Mirrors `find <missing>` exit behavior: print nothing, don't crash.
		rootDev = null;
	}

	if (rootDev !== null) {
		await walk(root, rootDev, projects, parseFailures, visited);
	}

	for (const path of parseFailures) {
		warn(`Skipping unparseable manifest: ${path}`);
	}

	// Deterministic ordering — keep table + JSON output stable across runs
	// regardless of filesystem traversal order.
	projects.sort((a, b) => a.path.localeCompare(b.path));

	if (opts?.json) {
		console.log(JSON.stringify(projects, null, 2));
		return;
	}

	if (projects.length === 0) {
		console.log("No skilltree projects found.");
		return;
	}

	printProjectsTable(projects);
}

/**
 * Recursive walker. Stops descending into a directory once we've found a
 * manifest there — nested manifests under a project are surprising in
 * practice and would inflate output on monorepos. Matches the spec example
 * (top-level project directories, not every manifest on disk).
 */
async function walk(
	dir: string,
	rootDev: number,
	projects: ProjectRow[],
	parseFailures: string[],
	visited: Set<string>,
): Promise<void> {
	let dirStat: Awaited<ReturnType<typeof stat>>;
	try {
		dirStat = await stat(dir);
	} catch {
		return; // permission denied / vanished / etc.
	}

	// Cross-filesystem boundary check — `--root` pins the device; any nested
	// mount (e.g. external drive, network share) is skipped per the spec.
	if (dirStat.dev !== rootDev) return;

	const key = `${dirStat.dev}:${dirStat.ino}`;
	if (visited.has(key)) return;
	visited.add(key);

	// Is THIS directory itself a project? If so, record and stop recursing.
	const manifestPath = await findManifest(dir);
	if (manifestPath !== null) {
		const row = await buildRow(dir, manifestPath);
		if (row === null) {
			parseFailures.push(manifestPath);
		} else {
			projects.push(row);
		}
		return;
	}

	let entries: Dirent[];
	try {
		entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
	} catch {
		return; // permission denied — skip silently
	}

	// Process subdirectories in parallel — most of the walk time is IO wait,
	// and Node's libuv pool will serialize the actual syscalls anyway.
	await Promise.all(
		entries.map(async (entry) => {
			if (!isDirCandidate(entry)) return;

			const name = entry.name;
			if (SKIP_DIR_NAMES.has(name)) return;
			if (name.startsWith(".") && !ALLOWED_HIDDEN_DIRS.has(name)) return;

			const fullPath = join(dir, name);
			if (SKIP_REL_SUFFIXES.some((suffix) => fullPath.endsWith(suffix))) return;

			await walk(fullPath, rootDev, projects, parseFailures, visited);
		}),
	);
}

/**
 * Treat a dirent as a directory candidate if it's a directory OR a symlink
 * (we resolve symlinks via the subsequent `stat()` in `walk`). `isDirectory`
 * alone would miss symlinked project directories — common when users `ln -s`
 * a worktree into a workspace folder.
 */
function isDirCandidate(entry: { isDirectory(): boolean; isSymbolicLink(): boolean }): boolean {
	return entry.isDirectory() || entry.isSymbolicLink();
}

/**
 * Look for both the canonical and legacy manifest names in `dir`. Returns
 * the absolute path of whichever exists first (yml wins on tie — matches
 * `resolveManifestPath`'s preference).
 */
async function findManifest(dir: string): Promise<string | null> {
	for (const filename of [MANIFEST_NEW, MANIFEST_NEW_ALT]) {
		const candidate = join(dir, filename);
		try {
			const s = await stat(candidate);
			if (s.isFile()) return candidate;
		} catch {
			// Not present — try the next.
		}
	}
	return null;
}

/**
 * Read + parse a manifest into a row. Returns null on parse failure so the
 * caller can record it for the consolidated warning pass — silently dropping
 * unparseable manifests was rejected in the issue ("emit a single dim
 * warning per skipped path").
 */
async function buildRow(projectDir: string, manifestPath: string): Promise<ProjectRow | null> {
	let content: string;
	try {
		content = await readFile(manifestPath, "utf-8");
	} catch {
		return null;
	}

	let deps = 0;
	let vendor = false;
	try {
		const manifest = parseManifest(content);
		deps =
			Object.keys(manifest.dependencies ?? {}).length +
			Object.keys(manifest["dev-dependencies"] ?? {}).length;
		vendor = manifest.vendor === true;
	} catch {
		return null;
	}

	const lockPath = join(projectDir, LOCKFILE_NEW);
	let lastInstall: string | null = null;
	try {
		const lockStat = await stat(lockPath);
		lastInstall = lockStat.mtime.toISOString();
	} catch {
		// No lockfile — leave null. Common for freshly-init'd projects that
		// haven't run `skilltree install` yet.
	}

	return {
		path: projectDir,
		manifestPath,
		deps,
		vendor,
		lastInstall,
	};
}

interface DisplayRow {
	path: string;
	deps: string;
	vendor: string;
	lastInstall: string;
}

const PROJECT_COLUMNS: ColumnDef<DisplayRow>[] = [
	{ header: "Path", value: (r) => r.path, color: pc.cyan },
	{ header: "Deps", value: (r) => r.deps },
	{ header: "Vendor", value: (r) => r.vendor, color: (v) => (v === "yes" ? pc.yellow(v) : dim(v)) },
	{ header: "Last install", value: (r) => r.lastInstall, color: dim },
];

function printProjectsTable(rows: ProjectRow[]): void {
	const display: DisplayRow[] = rows.map((r) => ({
		path: collapseTilde(r.path),
		deps: String(r.deps),
		vendor: r.vendor ? "yes" : "no",
		lastInstall: r.lastInstall ? formatRelativeTime(new Date(r.lastInstall)) : "—",
	}));
	printTable(display, PROJECT_COLUMNS);
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
// Calendar-aware buckets are intentionally avoided — "1 month ago" is fuzzy
// by design and a 30-day approximation matches what users expect from a
// single-glance status column.
const MS_PER_WEEK = 7 * MS_PER_DAY;
const MS_PER_MONTH = 30 * MS_PER_DAY;
const MS_PER_YEAR = 365 * MS_PER_DAY;

/**
 * Format a past `Date` as "N <unit> ago". Exported only via the row's ISO
 * field; the table builds the human form via this helper. Falls back to ISO
 * on future timestamps (clock skew on shared filesystems) so the table
 * stays readable.
 */
export function formatRelativeTime(then: Date, now: Date = new Date()): string {
	const diff = now.getTime() - then.getTime();
	if (diff < 0) return then.toISOString();
	if (diff < MS_PER_MINUTE) return "just now";
	if (diff < MS_PER_HOUR) return plural(Math.floor(diff / MS_PER_MINUTE), "minute");
	if (diff < MS_PER_DAY) return plural(Math.floor(diff / MS_PER_HOUR), "hour");
	if (diff < MS_PER_WEEK) return plural(Math.floor(diff / MS_PER_DAY), "day");
	if (diff < MS_PER_MONTH) return plural(Math.floor(diff / MS_PER_WEEK), "week");
	if (diff < MS_PER_YEAR) return plural(Math.floor(diff / MS_PER_MONTH), "month");
	return plural(Math.floor(diff / MS_PER_YEAR), "year");
}

function plural(n: number, unit: string): string {
	return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}
