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
	/**
	 * Present and true only when this hop is a `pack:` reference rather than an
	 * entity (#192). Omitted otherwise, so entity hops keep the shape they had.
	 */
	pack?: boolean;
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
			`"${target}" matches multiple entries: ${qualified}.\n${disambiguationHint(matches, opts?.type)}`,
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
	const packs = packKeys(lockfile);

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
					...(packs.has(name) ? { pack: true } : {}),
				})),
			),
		};
		const topGroup = groupOf(targetKey);
		if (topGroup) out.top_level = topGroup;
		console.log(JSON.stringify(out, null, 2));
		return;
	}

	renderText(target, targetEntry, targetKey, paths, groupOf, packs);
}

/**
 * Advise the discriminator that will actually narrow the result.
 *
 * `--type` only helps when it leaves exactly one entry. It cannot help when
 * the caller already passed it -- the filter has run and these matches
 * survived it -- nor when two matches share a type. Suggesting it regardless
 * told the user to re-run a command that would fail identically (#174).
 *
 * YAML keys are unique by construction, so they always disambiguate, and
 * `why` already accepts a key in place of a name.
 */
function disambiguationHint(
	matches: Array<{ key: string; entry: LockfileEntry }>,
	typeFilter: EntityType | undefined,
): string {
	// Distinct types for every match ⇒ filtering by type yields exactly one.
	const distinctTypes = new Set(matches.map((m) => m.entry.type)).size;
	if (typeFilter === undefined && distinctTypes === matches.length) {
		return "Re-run with --type <skill|agent|command> to disambiguate.";
	}
	const keys = matches.map((m) => m.key).join(", ");
	return `Re-run with one of these keys instead: ${keys}.`;
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
	const addParent = (childKey: string, parentKey: string): void => {
		let parents = parentsOf.get(childKey);
		if (!parents) {
			parents = new Set();
			parentsOf.set(childKey, parents);
		}
		parents.add(parentKey);
	};

	for (const [parentKey, entry] of Object.entries(lockfile.packages)) {
		for (const childName of entry.dependencies) {
			const childKey = nameIndex.get(childName);
			if (childKey === undefined) continue; // dangling reference; skip silently
			addParent(childKey, parentKey);
		}
		// A pack is never an entity, so no `packages` row lists its members as
		// dependencies and the members' own keys aren't manifest keys either.
		// Without this edge the walk dead-ends at the member — and, because
		// paths below a member can only reach a root through it, at everything
		// beneath it too (#192). `via_pack` is the consumer's yaml key for the
		// pack ref (#153), which is exactly what `rootSet` is built from.
		const pack = packAttribution(entry);
		if (pack !== undefined) addParent(parentKey, pack);
	}
	return parentsOf;
}

/**
 * The pack ref a lockfile entry was injected by, or `undefined`.
 *
 * A blank `via_pack` is hand-edited data rather than an absence, so it is not
 * read as a pack named `""` — see "Presence check ≠ value check" in CLAUDE.md.
 * `indexLockfileByPack` in `core/lockfile.ts` applies the same guard, and
 * agreeing with it is the point: a blank would not satisfy a pack reference
 * there, so it must not name one here either.
 *
 * No test covers the blank case because it is not observable through this
 * command's output — an empty parent key is not a manifest key, so the walk
 * dead-ends exactly as it would with no edge at all. The guard is parity with
 * the sibling helper, not a behavior this command can demonstrate.
 */
function packAttribution(entry: LockfileEntry): string | undefined {
	return entry.via_pack === undefined || entry.via_pack === "" ? undefined : entry.via_pack;
}

/**
 * Every pack ref the lockfile attributes an entry to. Used to label those hops
 * as packs when rendering: a pack has no `packages` row, so a hop can't be
 * recognized as one by looking it up.
 */
function packKeys(lockfile: Lockfile): Set<string> {
	const keys = new Set<string>();
	for (const entry of Object.values(lockfile.packages)) {
		const pack = packAttribution(entry);
		if (pack !== undefined) keys.add(pack);
	}
	return keys;
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
	packs: Set<string>,
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
		// Prefix pack hops so the chain doesn't read as though an entity by
		// that name exists — it doesn't; the pack is a manifest reference.
		const chain = reversed
			.map((n) => pc.cyan(packs.has(n) ? `pack:${n}` : n))
			.join(` ${dim("←")} `);
		const groupLabel = rootGroup ? `${rootGroup}: top-level` : "top-level";
		console.log(`  ${dim("←")} ${chain} ${dim(`(${groupLabel})`)}`);
	}
}
