import { readGlobalLockfile, readLockfile } from "../core/lockfile.js";
import { readGlobalManifest, readManifest } from "../core/manifest.js";
import { getGlobalDir } from "../core/paths.js";
import { dim, pc } from "../core/ui.js";
import type { EntityType, Lockfile, LockfileEntry } from "../types.js";

export interface DepsOptions {
	global?: boolean;
	globalDir?: string; // test override
	json?: boolean;
	/**
	 * Suppress recursion under already-printed subtrees. The legacy "stop on
	 * duplicate" behavior (cargo tree's default). Default `false` — every
	 * top-level subtree is rendered self-contained, with duplicates marked
	 * `(*)` (cli) or `deduped: true` (json) but their `dependencies` still
	 * populated. (Issue #47)
	 */
	dedupe?: boolean;
}

interface JsonTreeNode {
	name: string;
	type: EntityType;
	version?: string;
	source?: string;
	deduped?: boolean;
	dependencies: JsonTreeNode[];
}

/** cargo-tree convention: marks a node whose canonical print is elsewhere. */
const DUPLICATE_MARKER = "(*)";
const DEDUPED_LABEL = "deduped";

export async function depsTreeCommand(dir: string, opts?: DepsOptions): Promise<void> {
	const isGlobal = !!opts?.global;
	const globalDir = opts?.globalDir ?? getGlobalDir();

	const manifest = isGlobal ? await readGlobalManifest(globalDir) : await readManifest(dir);

	const lockfile = isGlobal ? await readGlobalLockfile(globalDir) : await readLockfile(dir);

	if (!lockfile) {
		const cmd = isGlobal ? "skilltree install --global" : "skilltree install";
		throw new Error(`No lockfile found. Run \`${cmd}\` first.`);
	}

	// Find root entries (direct manifest deps)
	const roots = new Set([
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest["dev-dependencies"] ?? {}),
	]);

	const dedupe = opts?.dedupe === true;

	if (opts?.json) {
		const printedJson = new Set<string>();
		const tree: JsonTreeNode[] = [];
		for (const root of roots) {
			const entry = lockfile.packages[root];
			if (!entry) continue;
			tree.push(buildJsonTree(root, entry, lockfile, printedJson, true, dedupe));
		}
		console.log(JSON.stringify(tree, null, 2));
		return;
	}

	const printed = new Set<string>();

	for (const root of roots) {
		const entry = lockfile.packages[root];
		if (!entry) continue;
		printTree(root, entry, lockfile, "", true, true, printed, dedupe);
	}
}

function buildJsonTree(
	name: string,
	entry: LockfileEntry,
	lockfile: Lockfile,
	printed: Set<string>,
	isRoot: boolean,
	dedupe: boolean,
): JsonTreeNode {
	const node: JsonTreeNode = {
		name,
		type: entry.type,
		dependencies: [],
	};
	if (entry.version) node.version = entry.version;
	if (entry.source) node.source = entry.source;

	const alreadyPrinted = printed.has(name);
	// Top-level entries are direct project deps; never mark them deduped
	// regardless of whether they were already printed transitively.
	if (alreadyPrinted && !isRoot) {
		node.deduped = true;
		// `--dedupe`: stop here so consumers walk on `deduped`. Default keeps
		// recursing so each subtree is structurally complete.
		if (dedupe) return node;
	}
	printed.add(name);

	for (const depName of entry.dependencies) {
		const depEntry = lockfile.packages[depName];
		if (!depEntry) continue;
		node.dependencies.push(buildJsonTree(depName, depEntry, lockfile, printed, false, dedupe));
	}
	return node;
}

function printTree(
	name: string,
	entry: { type: string; version?: string; source?: string; dependencies: string[] },
	lockfile: {
		packages: Record<
			string,
			{ type: string; version?: string; source?: string; dependencies: string[] }
		>;
	},
	prefix: string,
	isRoot: boolean,
	isLast: boolean,
	printed: Set<string>,
	dedupe: boolean,
): void {
	const connector = isRoot ? "" : isLast ? "└── " : "├── ";
	const version = entry.version ? `@${entry.version}` : "";
	const source = entry.source === "local" ? "local" : "";
	const alreadyPrinted = printed.has(name);

	if (alreadyPrinted && !isRoot && dedupe) {
		console.log(`${prefix}${connector}${dim(`${name} (${entry.type}, ${DEDUPED_LABEL})`)}`);
		return;
	}

	// Top-level entries (isRoot) are canonical project declarations and never
	// carry the (*) marker, even if their name was already printed transitively
	// in an earlier root's subtree. The marker only signals "this transitive
	// occurrence has been shown above; nothing new will appear below."
	const marker = alreadyPrinted && !isRoot ? ` ${dim(DUPLICATE_MARKER)}` : "";
	console.log(
		`${prefix}${connector}${pc.cyan(name)}${version ? pc.green(version) : ""} ${dim(`(${entry.type}${source ? `, ${source}` : ""})`)}${marker}`,
	);
	printed.add(name);

	const deps = entry.dependencies;
	for (let i = 0; i < deps.length; i++) {
		const depName = deps[i];
		if (!depName) continue;
		const depEntry = lockfile.packages[depName];
		if (!depEntry) continue;
		const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
		printTree(
			depName,
			depEntry,
			lockfile,
			childPrefix,
			false,
			i === deps.length - 1,
			printed,
			dedupe,
		);
	}
}
