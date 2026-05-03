import { readGlobalLockfile, readLockfile } from "../core/lockfile.js";
import { readGlobalManifest, readManifest } from "../core/manifest.js";
import { getGlobalDir } from "../core/paths.js";
import { dim, pc } from "../core/ui.js";
import type { EntityType, Lockfile, LockfileEntry } from "../types.js";

export interface DepsOptions {
	global?: boolean;
	globalDir?: string; // test override
	json?: boolean;
}

interface JsonTreeNode {
	name: string;
	type: EntityType;
	version?: string;
	source?: string;
	deduped?: boolean;
	dependencies: JsonTreeNode[];
}

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

	if (opts?.json) {
		const printedJson = new Set<string>();
		const tree: JsonTreeNode[] = [];
		for (const root of roots) {
			const entry = lockfile.packages[root];
			if (!entry) continue;
			tree.push(buildJsonTree(root, entry, lockfile, printedJson));
		}
		console.log(JSON.stringify(tree, null, 2));
		return;
	}

	const printed = new Set<string>();

	for (const root of roots) {
		const entry = lockfile.packages[root];
		if (!entry) continue;
		printTree(root, entry, lockfile, "", true, true, printed);
	}
}

function buildJsonTree(
	name: string,
	entry: LockfileEntry,
	lockfile: Lockfile,
	printed: Set<string>,
): JsonTreeNode {
	const node: JsonTreeNode = {
		name,
		type: entry.type,
		dependencies: [],
	};
	if (entry.version) node.version = entry.version;
	if (entry.source) node.source = entry.source;

	if (printed.has(name)) {
		// Mirror the human renderer: don't recurse into already-printed subtrees.
		// Consumers walk on `deduped` instead of duplicating the whole subtree.
		node.deduped = true;
		return node;
	}
	printed.add(name);

	for (const depName of entry.dependencies) {
		const depEntry = lockfile.packages[depName];
		if (!depEntry) continue;
		node.dependencies.push(buildJsonTree(depName, depEntry, lockfile, printed));
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
): void {
	const connector = isRoot ? "" : isLast ? "└── " : "├── ";
	const version = entry.version ? `@${entry.version}` : "";
	const source = entry.source === "local" ? "local" : "";

	if (printed.has(name)) {
		console.log(`${prefix}${connector}${dim(`${name} (${entry.type}, deduped)`)}`);
		return;
	}

	console.log(
		`${prefix}${connector}${pc.cyan(name)}${version ? pc.green(version) : ""} ${dim(`(${entry.type}${source ? `, ${source}` : ""})`)}`,
	);
	printed.add(name);

	const deps = entry.dependencies;
	for (let i = 0; i < deps.length; i++) {
		const depName = deps[i];
		if (!depName) continue;
		const depEntry = lockfile.packages[depName];
		if (!depEntry) continue;
		const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
		printTree(depName, depEntry, lockfile, childPrefix, false, i === deps.length - 1, printed);
	}
}
