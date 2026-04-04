import { manifestExists } from "../core/filenames.js";
import { readGlobalLockfile, readLockfile } from "../core/lockfile.js";
import { readManifest } from "../core/manifest.js";
import { getGlobalDir } from "../core/paths.js";
import { dim, pc } from "../core/ui.js";
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
		throw new Error("No skilltree.yaml found. Run `skilltree init` first.");
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
}

function buildRows(lockfile: Lockfile): ListRow[] {
	return Object.entries(lockfile.packages).map(([key, entry]) => ({
		name: entry.name ?? key,
		type: entry.type,
		group: entry.group,
		version: entry.version ?? (entry.source === "local" ? "local" : "-"),
		source: entry.source === "local" ? entry.path : (entry.repo ?? "-"),
	}));
}

function printGlobalTable(rows: ListRow[]): void {
	const widths = {
		name: Math.max(4, ...rows.map((r) => r.name.length)),
		type: Math.max(4, ...rows.map((r) => r.type.length)),
		version: Math.max(7, ...rows.map((r) => r.version.length)),
		source: Math.max(6, ...rows.map((r) => r.source.length)),
	};

	console.log(
		pc.bold(
			`${"Name".padEnd(widths.name)}  ${"Type".padEnd(widths.type)}  ${"Version".padEnd(widths.version)}  Source`,
		),
	);
	console.log(dim("-".repeat(widths.name + widths.type + widths.version + widths.source + 6)));
	for (const row of rows) {
		console.log(
			`${pc.cyan(row.name.padEnd(widths.name))}  ${dim(row.type.padEnd(widths.type))}  ${pc.green(row.version.padEnd(widths.version))}  ${dim(row.source)}`,
		);
	}
}

async function printProjectTable(rows: ListRow[], dir: string, globalDir: string): Promise<void> {
	const widths = {
		name: Math.max(4, ...rows.map((r) => r.name.length)),
		type: Math.max(4, ...rows.map((r) => r.type.length)),
		group: Math.max(5, ...rows.map((r) => r.group.length)),
		version: Math.max(7, ...rows.map((r) => r.version.length)),
		source: Math.max(6, ...rows.map((r) => r.source.length)),
	};

	const hdr = `${"Name".padEnd(widths.name)}  ${"Type".padEnd(widths.type)}  ${"Group".padEnd(widths.group)}  ${"Version".padEnd(widths.version)}  Source`;

	console.log(pc.bold(hdr));
	console.log(
		dim("-".repeat(widths.name + widths.type + widths.group + widths.version + widths.source + 8)),
	);
	for (const row of rows) {
		console.log(
			`${pc.cyan(row.name.padEnd(widths.name))}  ${dim(row.type.padEnd(widths.type))}  ${dim(row.group.padEnd(widths.group))}  ${pc.green(row.version.padEnd(widths.version))}  ${dim(row.source)}`,
		);
	}

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
