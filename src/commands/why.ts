import { buildNameIndex, readGlobalLockfile, readLockfile } from "../core/lockfile.js";
import { readGlobalManifest, readManifest } from "../core/manifest.js";
import { getGlobalDir } from "../core/paths.js";
import { dim, pc } from "../core/ui.js";
import type { EntityType, Lockfile, LockfileEntry } from "../types.js";

/**
 * `skilltree why <name>` — reverse-lookup which top-level dependency pulled in
 * a given entity. Reads `skilltree.lock` only; never writes. Mirrors the
 * `npm why` / `cargo why` mental model. Tracks issue #80.
 */
export interface WhyOptions {
	/** Project directory containing `skilltree.yml` + `skilltree.lock`. */
	dir?: string;
	/** Read the global manifest/lockfile under `~/.skilltree`. */
	global?: boolean;
	/** Test override for the global dir. */
	globalDir?: string;
	/** Disambiguate when the name resolves to multiple entity types. */
	type?: EntityType;
	/** Emit JSON instead of human-readable text. */
	json?: boolean;
}

type Group = "dependencies" | "dev-dependencies";

interface JsonHop {
	name: string;
	/** Non-null only on the root hop (the top-level dep that started the path). */
	group: Group | null;
}

interface JsonOutput {
	name: string;
	type: EntityType;
	/** Empty array when the target is itself a top-level dep. */
	paths: JsonHop[][];
	/** Set when the target is a top-level dep; identifies which group. */
	top_level?: Group;
}

export async function whyCommand(target: string, opts?: WhyOptions): Promise<void> {
	const dir = opts?.dir ?? process.cwd();
	const isGlobal = !!opts?.global;
	const globalDir = opts?.globalDir ?? getGlobalDir();

	const manifest = isGlobal ? await readGlobalManifest(globalDir) : await readManifest(dir);
	const lockfile = isGlobal ? await readGlobalLockfile(globalDir) : await readLockfile(dir);

	if (!lockfile) {
		const cmd = isGlobal ? "skilltree install --global" : "skilltree install";
		throw new Error(`No lockfile found. Run \`${cmd}\` first.`);
	}

	// 1. Find all packages matching `target` (by YAML key or by `name` field).
	//    The lockfile is keyed by the YAML alias; when an entry was authored
	//    with `name: foo` under a different key, that needs to match too.
	const matches = findMatches(lockfile, target, opts?.type);

	if (matches.length === 0) {
		throw new Error(
			`"${target}" is not in skilltree.lock. Did you mean to run \`skilltree install\` first?`,
		);
	}

	if (matches.length > 1) {
		const qualified = matches.map((m) => `${m.key} (${m.entry.type})`).join(", ");
		throw new Error(
			`"${target}" matches multiple entries: ${qualified}.\nRe-run with --type <skill|agent|command> to disambiguate.`,
		);
	}

	// Exactly one match remains (the 0 and >1 branches above returned).
	// Destructure via guard to satisfy TS noUncheckedIndexedAccess.
	const [sole] = matches;
	if (!sole) throw new Error(`Internal: unreachable — match length invariant violated`);
	const { key: targetKey, entry: targetEntry } = sole;

	// 2. Catalogue top-level deps and their groups.
	const topProd = new Set(Object.keys(manifest.dependencies ?? {}));
	const topDev = new Set(Object.keys(manifest["dev-dependencies"] ?? {}));
	const groupOf = (k: string): Group | undefined => {
		if (topProd.has(k)) return "dependencies";
		if (topDev.has(k)) return "dev-dependencies";
		return undefined;
	};

	// 3. Build reverse adjacency: child YAML key → set of parent YAML keys.
	const parentsOf = buildReverseAdjacency(lockfile);

	// 4. Walk upward from the target, recording every path that ends at a
	//    top-level dep. The target itself is omitted from each path.
	const rootSet = new Set<string>([...topProd, ...topDev]);
	const paths = collectPathsToRoots(targetKey, parentsOf, rootSet);

	// 5. Render.
	if (opts?.json) {
		const out: JsonOutput = {
			name: target,
			type: targetEntry.type,
			paths: paths.map((p) =>
				p.map((name, i) => ({
					name,
					group: i === 0 ? (groupOf(name) ?? null) : null,
				})),
			),
		};
		const topGroup = groupOf(targetKey);
		if (topGroup) out.top_level = topGroup;
		console.log(JSON.stringify(out, null, 2));
		return;
	}

	renderText(target, targetEntry, targetKey, paths, groupOf);
}

function findMatches(
	lockfile: Lockfile,
	target: string,
	typeFilter: EntityType | undefined,
): Array<{ key: string; entry: LockfileEntry }> {
	const out: Array<{ key: string; entry: LockfileEntry }> = [];
	for (const [key, entry] of Object.entries(lockfile.packages)) {
		const nameMatches = key === target || entry.name === target;
		if (!nameMatches) continue;
		if (typeFilter && entry.type !== typeFilter) continue;
		out.push({ key, entry });
	}
	return out;
}

function buildReverseAdjacency(lockfile: Lockfile): Map<string, Set<string>> {
	// Translate child references (entity names) → YAML keys so the upward
	// walk's keys line up with the matched target's YAML key. See
	// `buildNameIndex` for the underlying alias-vs-name issue.
	const nameIndex = buildNameIndex(lockfile);
	const parentsOf = new Map<string, Set<string>>();
	for (const [parentKey, entry] of Object.entries(lockfile.packages)) {
		for (const childName of entry.dependencies) {
			const childKey = nameIndex.get(childName);
			if (childKey === undefined) continue; // dangling reference; skip silently
			let parents = parentsOf.get(childKey);
			if (!parents) {
				parents = new Set();
				parentsOf.set(childKey, parents);
			}
			parents.add(parentKey);
		}
	}
	return parentsOf;
}

function collectPathsToRoots(
	targetKey: string,
	parentsOf: Map<string, Set<string>>,
	roots: Set<string>,
): string[][] {
	const paths: string[][] = [];

	// DFS upward. `currentPath` is the chain *below* `node`, ordered from
	// the immediate parent down to the original target (target last).
	// When `node` is a root, we record [node, ...currentPath].
	const walk = (node: string, currentPath: string[], visited: Set<string>): void => {
		if (roots.has(node)) {
			paths.push([node, ...currentPath]);
			// Don't stop here — a root could itself be transitively pulled in
			// by another root (e.g., target is also a top-level). Continue
			// exploring upward so longer chains are also surfaced.
		}
		const parents = parentsOf.get(node);
		if (!parents) return;
		for (const parent of parents) {
			if (visited.has(parent)) continue; // cycle protection
			const nextVisited = new Set(visited);
			nextVisited.add(parent);
			walk(parent, [node, ...currentPath], nextVisited);
		}
	};

	const seed = new Set<string>([targetKey]);
	const parents = parentsOf.get(targetKey);
	if (parents) {
		for (const parent of parents) {
			if (seed.has(parent)) continue;
			const nextVisited = new Set(seed);
			nextVisited.add(parent);
			walk(parent, [targetKey], nextVisited);
		}
	}

	// Drop the target itself from each path — callers expect each path to
	// list only the chain *to* the target, not including it.
	return paths.map((p) => p.slice(0, -1));
}

function renderText(
	target: string,
	targetEntry: LockfileEntry,
	targetKey: string,
	paths: string[][],
	groupOf: (k: string) => Group | undefined,
): void {
	const topGroup = groupOf(targetKey);

	// Header always names the target with its type.
	console.log(`${pc.cyan(target)} ${dim(`(${targetEntry.type})`)} ${pc.dim("←")}`);

	if (paths.length === 0) {
		// Either it's a top-level dep with no upstream, or it's somehow
		// orphaned (in lockfile but no top-level reaches it — shouldn't
		// happen after a clean install but report it cleanly).
		if (topGroup) {
			console.log(`  ${dim(`(top-level: ${topGroup})`)}`);
		} else {
			console.log(`  ${dim("(no top-level dependency transitively depends on this entry)")}`);
		}
		return;
	}

	// If the target is *also* a top-level dep, lead with that line so the
	// user sees the direct declaration before the transitive chains.
	if (topGroup) {
		console.log(`  ${dim(`(top-level: ${topGroup})`)}`);
	}

	for (const path of paths) {
		// path is [root, mid1, mid2, ...] (target excluded).
		// Display as: ← mid_last ← ... ← mid1 ← root ← (group: top-level)
		// — closer-to-target hops come first when read left to right.
		const root = path[0];
		if (!root) continue; // collectPathsToRoots never emits empty paths; guard for TS
		const rootGroup = groupOf(root);
		const reversed = [...path].reverse(); // now ends with root
		const chain = reversed.map((n) => pc.cyan(n)).join(` ${dim("←")} `);
		const groupLabel = rootGroup ? `${rootGroup}: top-level` : "top-level";
		console.log(`  ${dim("←")} ${chain} ${dim(`(${groupLabel})`)}`);
	}
}
