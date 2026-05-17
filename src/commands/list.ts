import { MANIFEST_NEW, manifestExists } from "../core/filenames.js";
import { readGlobalLockfile, readLockfile } from "../core/lockfile.js";
import { readManifest } from "../core/manifest.js";
import { getGlobalDir } from "../core/paths.js";
import { type ColumnDef, dim, pc, printTable } from "../core/ui.js";
import type { Lockfile } from "../types.js";

export interface ListOptions {
	json?: boolean;
	global?: boolean;
	globalDir?: string; // test override
}

export async function listCommand(dir: string, opts?: ListOptions): Promise<void> {
	const isGlobal = !!opts?.global;
	const globalDir = opts?.globalDir ?? getGlobalDir();

	const lockfile = isGlobal ? await readGlobalLockfile(globalDir) : await readLockfile(dir);

	if (!isGlobal && !manifestExists(dir)) {
		throw new Error(`No ${MANIFEST_NEW} found. Run \`skilltree init\` first.`);
	}

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

	const rows = buildRows(lockfile);

	if (opts?.json) {
		console.log(JSON.stringify(rows, null, 2));
		return;
	}

	if (isGlobal) {
		printGlobalTable(rows);
	} else {
		printProjectTable(rows, dir, globalDir);
	}
}

interface ListRow {
	name: string;
	type: string;
	group: string;
	version: string;
	source: string;
	/** Resolved commit SHA — present for remote deps, omitted for `source: local`. */
	commit?: string;
}

/** Short SHA convention used elsewhere in the codebase (see graph.ts install warnings). */
const SHORT_SHA_LEN = 7;

/**
 * Display label for a lockfile entry's version column.
 *
 * Falls back to `@<short-sha>` for unpinned remote deps (issue #76) so users
 * still see a meaningful identifier instead of a bare `-`. Local deps keep
 * their `"local"` label; the literal `"-"` only appears when neither version
 * nor commit is recorded.
 */
function versionLabel(entry: Lockfile["packages"][string]): string {
	if (entry.version !== undefined) return entry.version;
	if (entry.source === "local") return "local";
	if (entry.commit) return `@${entry.commit.slice(0, SHORT_SHA_LEN)}`;
	return "-";
}

function buildRows(lockfile: Lockfile): ListRow[] {
	return Object.entries(lockfile.packages).map(([key, entry]) => {
		const row: ListRow = {
			name: entry.name ?? key,
			type: entry.type,
			group: entry.group,
			version: versionLabel(entry),
			source: entry.source === "local" ? entry.path : (entry.repo ?? "-"),
		};
		// Surface the full commit for non-local entries so `--json` consumers
		// can resolve unpinned deps without re-parsing the lockfile (issue #76).
		if (entry.source !== "local" && entry.commit) {
			row.commit = entry.commit;
		}
		return row;
	});
}

// Shared column definitions. `dim` and `pc.green` etc. read like CSS classes —
// the helper applies them per data cell and leaves the header bold.
const NAME_COL: ColumnDef<ListRow> = { header: "Name", value: (r) => r.name, color: pc.cyan };
const TYPE_COL: ColumnDef<ListRow> = { header: "Type", value: (r) => r.type, color: dim };
const VERSION_COL: ColumnDef<ListRow> = {
	header: "Version",
	value: (r) => r.version,
	color: pc.green,
};
const SOURCE_COL: ColumnDef<ListRow> = { header: "Source", value: (r) => r.source, color: dim };

function printGlobalTable(rows: ListRow[]): void {
	printTable(rows, [NAME_COL, TYPE_COL, VERSION_COL, SOURCE_COL]);
}

async function printProjectTable(rows: ListRow[], dir: string, globalDir: string): Promise<void> {
	printTable(rows, [
		NAME_COL,
		TYPE_COL,
		{ header: "Group", value: (r) => r.group, color: dim },
		VERSION_COL,
		SOURCE_COL,
	]);

	// Vendor mode indicator
	try {
		const manifest = await readManifest(dir);
		if (manifest.vendor) {
			console.log(pc.yellow("\nVendor mode active — all deps are committed to git."));
		}
	} catch {
		// No manifest — skip
	}

	// Footer hint about global deps
	const globalLockfile = await readGlobalLockfile(globalDir);
	if (globalLockfile && Object.keys(globalLockfile.packages).length > 0) {
		const count = Object.keys(globalLockfile.packages).length;
		console.log(
			dim(`\nAlso: ${count} global dep${count > 1 ? "s" : ""} installed (skilltree list --global)`),
		);
	}
}
