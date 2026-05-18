import { buildNameIndex, readGlobalLockfile, readLockfile } from "../core/lockfile.js";
import { readGlobalManifest, readManifest } from "../core/manifest.js";
import { getGlobalDir } from "../core/paths.js";
import { dim, pc } from "../core/ui.js";
import type { EntityType, Lockfile, LockfileEntry } from "../types.js";
import { SHORT_SHA_LEN } from "./list.js";

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
	/**
	 * Resolved commit SHA for non-local entries — present whether or not the
	 * caller pinned a version (issue #94). Lets `--json` consumers identify
	 * what was actually installed without re-parsing the lockfile.
	 */
	commit?: string;
	source?: string;
	deduped?: boolean;
	dependencies: JsonTreeNode[];
}

/** cargo-tree convention: marks a node whose canonical print is elsewhere. */
const DUPLICATE_MARKER = "(*)";
const DEDUPED_LABEL = "deduped";

/**
 * Tree-display version suffix. Issue #94: unpinned remote deps drop to
 * `@<short-sha>` instead of an empty string so the user can still see which
 * commit was resolved. Local deps render no version suffix — the `(..., local)`
 * type tag already conveys "no pinning applies."
 *
 * Distinct from `versionLabel` in `list.ts`: that one returns mixed shapes
 * (`"1.0.0"` for versions, `"@abc1234"` for commits) suited to a tabular
 * column. The tree always wants the `@` prefix.
 */
function treeVersionLabel(entry: LockfileEntry): string {
	if (entry.version !== undefined) return `@${entry.version}`;
	if (entry.source === "local") return "";
	if (entry.commit) return `@${entry.commit.slice(0, SHORT_SHA_LEN)}`;
	return "";
}

/**
 * Canonical display name for a node, regardless of root vs. transitive
 * position. Issue #107: roots previously rendered under their YAML key while
 * transitives rendered under the frontmatter `name:` from the parent's
 * `dependencies:` list — the same entity appeared with two different labels
 * inside one tree when aliased.
 *
 * Single rule: prefer the canonical `entry.name` (which is what frontmatter
 * references resolve to), fall back to the lookup key. Roots that aren't
 * aliased still print under their YAML key (no `entry.name` set).
 */
function canonicalDisplayName(entry: LockfileEntry, lookupKey: string): string {
	return entry.name ?? lookupKey;
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

	const dedupe = opts?.dedupe === true;

	// Resolve transitive name → YAML key once per command (issue #102, see
	// `buildNameIndex` in core/lockfile.ts).
	const nameIndex = buildNameIndex(lockfile);

	if (opts?.json) {
		const printedJson = new Set<string>();
		const tree: JsonTreeNode[] = [];
		for (const root of roots) {
			const entry = lockfile.packages[root];
			if (!entry) continue;
			// Issue #107: roots use the same canonical name rule as transitives
			// (entry.name ?? key) so an aliased entry doesn't appear under
			// two different labels in the same tree.
			const displayName = canonicalDisplayName(entry, root);
			tree.push(
				buildJsonTree(displayName, root, entry, lockfile, nameIndex, printedJson, true, dedupe),
			);
		}
		console.log(JSON.stringify(tree, null, 2));
		return;
	}

	const printed = new Set<string>();

	for (const root of roots) {
		const entry = lockfile.packages[root];
		if (!entry) continue;
		const displayName = canonicalDisplayName(entry, root);
		printTree(displayName, root, entry, lockfile, nameIndex, "", true, true, printed, dedupe);
	}
}

/**
 * `displayName` is what the user wrote (YAML key for roots, frontmatter name
 * for transitive references). `entryKey` is the canonical YAML key in
 * `lockfile.packages` — the dedup tracker keys on it so the same entity
 * reached under both an alias and its name is recognized as one (issue #102).
 */
function buildJsonTree(
	displayName: string,
	entryKey: string,
	entry: LockfileEntry,
	lockfile: Lockfile,
	nameIndex: Map<string, string>,
	printed: Set<string>,
	isRoot: boolean,
	dedupe: boolean,
): JsonTreeNode {
	const node: JsonTreeNode = {
		name: displayName,
		type: entry.type,
		dependencies: [],
	};
	if (entry.version) node.version = entry.version;
	if (entry.source) node.source = entry.source;
	// Surface the resolved commit for every non-local entry so consumers can
	// identify the exact installed revision (issue #94). For local deps the
	// lockfile records `commit: HEAD` which is meaningless — skip it there.
	if (entry.source !== "local" && entry.commit) node.commit = entry.commit;

	const alreadyPrinted = printed.has(entryKey);
	// Top-level entries are direct project deps; never mark them deduped
	// regardless of whether they were already printed transitively.
	if (alreadyPrinted && !isRoot) {
		node.deduped = true;
		// `--dedupe`: stop here so consumers walk on `deduped`. Default keeps
		// recursing so each subtree is structurally complete.
		if (dedupe) return node;
	}
	printed.add(entryKey);

	for (const depName of entry.dependencies) {
		const depKey = nameIndex.get(depName);
		if (!depKey) continue;
		const depEntry = lockfile.packages[depKey];
		if (!depEntry) continue;
		// Render the child under the name the parent's frontmatter used,
		// not its YAML alias — matches the mental model of "this skill needs
		// this other skill."
		node.dependencies.push(
			buildJsonTree(depName, depKey, depEntry, lockfile, nameIndex, printed, false, dedupe),
		);
	}
	return node;
}

function printTree(
	displayName: string,
	entryKey: string,
	entry: LockfileEntry,
	lockfile: Lockfile,
	nameIndex: Map<string, string>,
	prefix: string,
	isRoot: boolean,
	isLast: boolean,
	printed: Set<string>,
	dedupe: boolean,
): void {
	const connector = isRoot ? "" : isLast ? "└── " : "├── ";
	const version = treeVersionLabel(entry);
	const source = entry.source === "local" ? "local" : "";
	const alreadyPrinted = printed.has(entryKey);

	if (alreadyPrinted && !isRoot && dedupe) {
		console.log(`${prefix}${connector}${dim(`${displayName} (${entry.type}, ${DEDUPED_LABEL})`)}`);
		return;
	}

	// Top-level entries (isRoot) are canonical project declarations and never
	// carry the (*) marker, even if they were already printed transitively
	// in an earlier root's subtree. The marker only signals "this transitive
	// occurrence has been shown above; nothing new will appear below."
	const marker = alreadyPrinted && !isRoot ? ` ${dim(DUPLICATE_MARKER)}` : "";
	console.log(
		`${prefix}${connector}${pc.cyan(displayName)}${version ? pc.green(version) : ""} ${dim(`(${entry.type}${source ? `, ${source}` : ""})`)}${marker}`,
	);
	printed.add(entryKey);

	const deps = entry.dependencies;
	for (let i = 0; i < deps.length; i++) {
		const depName = deps[i];
		if (!depName) continue;
		const depKey = nameIndex.get(depName);
		if (!depKey) continue;
		const depEntry = lockfile.packages[depKey];
		if (!depEntry) continue;
		const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
		printTree(
			depName,
			depKey,
			depEntry,
			lockfile,
			nameIndex,
			childPrefix,
			false,
			i === deps.length - 1,
			printed,
			dedupe,
		);
	}
}
