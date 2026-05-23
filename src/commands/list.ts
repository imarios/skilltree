import { MANIFEST_NEW, manifestExists } from "../core/filenames.js";
import { readGlobalLockfile, readLockfile } from "../core/lockfile.js";
import { readManifest } from "../core/manifest.js";
import { getGlobalDir } from "../core/paths.js";
import { type ColumnDef, dim, pc, printTable } from "../core/ui.js";
import type { Lockfile, Manifest } from "../types.js";

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

	// Read manifest up front (project mode only) so we can render the
	// publisher-side "Defined packs" footer (#143) regardless of whether the
	// lockfile is empty. Global mode has no packs surface.
	const manifest = !isGlobal ? await safeReadManifest(dir) : undefined;

	if (!lockfile || Object.keys(lockfile.packages).length === 0) {
		if (opts?.json) {
			console.log("[]");
		} else {
			console.log(
				isGlobal
					? "No global dependencies installed. Run `skilltree install --global`."
					: "No dependencies installed. Run `skilltree install`.",
			);
		}
		// Publisher repos commonly define packs without installing them
		// locally. Surface them even when the entity table is empty so
		// maintainers can confirm what their repo publishes.
		if (!opts?.json && manifest) printDefinedPacks(manifest);
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
		await printProjectTable(rows, dir, globalDir);
		if (manifest) printDefinedPacks(manifest);
	}
}

async function safeReadManifest(dir: string): Promise<Manifest | undefined> {
	try {
		return await readManifest(dir);
	} catch {
		return undefined;
	}
}

/**
 * Publisher-side pack visibility (#143). Renders one line per pack defined
 * in `manifest.packs`, with its member count. No-op when packs is absent
 * or empty. Consumer-side pack attribution (Via Pack column on member
 * rows) is deferred — needs `pack_resolutions:` in the lockfile, which
 * was explicitly future-work in the Oxygen spec.
 */
function printDefinedPacks(manifest: Manifest): void {
	const packs = manifest.packs ?? {};
	const entries = Object.entries(packs);
	if (entries.length === 0) return;
	console.log(pc.bold("\nDefined packs:"));
	for (const [name, members] of entries) {
		const count = members.length;
		console.log(`  ${pc.cyan(name)}  ${dim(`${count} member${count === 1 ? "" : "s"}`)}`);
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
	/**
	 * Consumer-side pack attribution (#153). Populated only for entries
	 * injected by a pack expansion; rendered as the "Via Pack" column in
	 * text mode and as `viaPack` in --json output.
	 */
	viaPack?: string;
}

/** Short SHA convention used elsewhere in the codebase (see graph.ts install warnings). */
export const SHORT_SHA_LEN = 7;

/**
 * Display label for a lockfile entry's version column.
 *
 * Falls back to `@<short-sha>` for unpinned remote deps (issue #76) so users
 * still see a meaningful identifier instead of a bare `-`. Local deps keep
 * their `"local"` label; the literal `"-"` only appears when neither version
 * nor commit is recorded.
 *
 * Exported so `deps tree` and any future inspection command can share the
 * same rendering convention without re-implementing the fallback (issue #94).
 */
export function versionLabel(entry: Lockfile["packages"][string]): string {
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
		// #153: only attach viaPack when present so direct deps stay clean in
		// JSON output and the column-presence check in `printProjectTable`
		// can use a plain `=== undefined` test. Presence check per the
		// hardening pattern — a hand-edited `via_pack: ""` flows through
		// unchanged so the bad data is visible rather than silently dropped.
		if (entry.via_pack !== undefined) {
			row.viaPack = entry.via_pack;
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
const VIA_PACK_COL: ColumnDef<ListRow> = {
	header: "Via Pack",
	value: (r) => r.viaPack ?? "—",
	color: pc.magenta,
};

function printGlobalTable(rows: ListRow[]): void {
	printTable(rows, [NAME_COL, TYPE_COL, VERSION_COL, SOURCE_COL]);
}

async function printProjectTable(rows: ListRow[], dir: string, globalDir: string): Promise<void> {
	// #153: only show the Via Pack column when at least one row has pack
	// attribution. Projects that don't use packs stay visually unchanged.
	const hasPackAttribution = rows.some((r) => r.viaPack !== undefined);
	const columns: ColumnDef<ListRow>[] = [
		NAME_COL,
		TYPE_COL,
		{ header: "Group", value: (r) => r.group, color: dim },
	];
	if (hasPackAttribution) columns.push(VIA_PACK_COL);
	columns.push(VERSION_COL, SOURCE_COL);
	printTable(rows, columns);

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
