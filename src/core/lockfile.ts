import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import semver from "semver";
import YAML from "yaml";
import pkg from "../../package.json";
import type {
	Dependency,
	Lockfile,
	LockfileEntry,
	Manifest,
	PackDependency,
	PackResolution,
} from "../types.js";
import { isLocalDependency, isPackDependency, isRemoteDependency } from "../types.js";
import { resolveGlobalLockfilePath, resolveLockfilePath } from "./filenames.js";
import type { ResolvedEntity } from "./graph.js";
import { expandSources } from "./manifest.js";
import { collapseTilde, expandTilde } from "./paths.js";

/**
 * Build a lockfile from resolved entities.
 * When `global: true`, collapses absolute paths to tilde format for portability.
 *
 * Pass `manifest` to record `pack_resolutions` (#164) — the member set each
 * `pack:` reference expanded to. Omitting it produces a lockfile without that
 * section, which readers handle (they fall back to presence-only pack
 * matching), so existing callers keep working; new callers should pass it.
 */
export function buildLockfile(
	entities: Map<string, ResolvedEntity>,
	options?: { global?: boolean; manifest?: Manifest },
): Lockfile {
	const packages: Record<string, LockfileEntry> = {};
	const isGlobal = options?.global ?? false;

	// Use install order for consistent output, but sort keys alphabetically
	const sortedKeys = [...entities.keys()].sort();

	for (const compositeKey of sortedKeys) {
		const entity = entities.get(compositeKey);
		if (!entity) continue;

		const entryPath = isGlobal && entity.local ? collapseTilde(entity.path) : entity.path;

		const entry: LockfileEntry = {
			type: entity.type,
			group: entity.group,
			path: entryPath,
			commit: entity.commit,
			dependencies: [...entity.dependencies].sort(),
		};

		if (entity.repo) {
			entry.repo = entity.repo;
		}

		if (entity.local) {
			entry.source = "local";
		}

		if (entity.version) {
			entry.version = entity.version;
		}

		if (entity.name !== entity.key) {
			entry.name = entity.name;
		}

		// #153: persist pack provenance so `list` can render the consumer-side
		// "Via Pack" column. The resolver expands packs into N flat entries
		// before the lockfile is written, so without this field the attribution
		// is lost by the time `list` reads back. Presence check, per the
		// hardening pattern — direct deps leave the field unset, not "".
		if (entity.viaPack !== undefined) {
			entry.via_pack = entity.viaPack;
		}

		packages[entity.key] = entry;
	}

	const lockfile: Lockfile = {
		lockfile_version: 1,
		packages,
	};

	// Presence check, not truthiness: an empty resolutions map means "this
	// manifest declares no packs", which should leave the key off entirely
	// rather than serialize `pack_resolutions: {}`.
	const packResolutions =
		options?.manifest === undefined ? undefined : buildPackResolutions(options.manifest, entities);
	if (packResolutions !== undefined) {
		lockfile.pack_resolutions = packResolutions;
	}

	return lockfile;
}

/**
 * Record what each `pack:` reference in the manifest expanded to (#164).
 *
 * The member set is recovered from the entities themselves — every member
 * carries `viaPack` set during pack expansion — so this stays in step with
 * whatever the resolver actually produced rather than re-deriving it from the
 * manifest. The pack's own name and repo come from the manifest entry, which
 * is what makes a rename or retarget under a stable yaml key detectable.
 *
 * Returns `undefined` when the manifest declares no pack references, so the
 * lockfile omits the section rather than carrying an empty map.
 */
function buildPackResolutions(
	manifest: Manifest,
	entities: Map<string, ResolvedEntity>,
): Record<string, PackResolution> | undefined {
	const expanded = expandSources(manifest);
	const packRefs: Record<string, Dependency> = {};
	for (const [key, dep] of Object.entries({
		...expanded.dependencies,
		...expanded["dev-dependencies"],
	})) {
		if (isPackDependency(dep)) packRefs[key] = dep;
	}
	if (Object.keys(packRefs).length === 0) return undefined;

	const membersByPack = new Map<string, string[]>();
	for (const entity of entities.values()) {
		if (entity.viaPack === undefined) continue;
		const members = membersByPack.get(entity.viaPack) ?? [];
		members.push(entity.key);
		membersByPack.set(entity.viaPack, members);
	}

	const resolutions: Record<string, PackResolution> = {};
	for (const [key, dep] of Object.entries(packRefs)) {
		if (!isPackDependency(dep)) continue;
		const resolution: PackResolution = {
			pack: dep.pack,
			// Sorted so the lockfile is byte-stable across runs — resolution
			// order is an implementation detail and must not churn the file.
			members: (membersByPack.get(key) ?? []).sort(),
		};
		if (dep.repo !== undefined) resolution.repo = dep.repo;
		resolutions[key] = resolution;
	}
	return resolutions;
}

/**
 * Build a `name → YAML key` index for a lockfile.
 *
 * Background (issue #102): `LockfileEntry.dependencies` is a list of entity
 * **names** (read from frontmatter), but `lockfile.packages` is keyed by the
 * **YAML alias** the user authored. Whenever a graph reader walks
 * `entry.dependencies` and needs the corresponding entry, it must translate
 * name → key first. In the common case (alias == name) the translation is
 * identity; when the user aliased the entry (e.g. `pc:` with `name:
 * python-coding`), the raw `packages[depName]` lookup silently misses.
 *
 * The index includes identity entries (`key → key`) for every package so
 * callers can `index.get(ref) ?? ref` uniformly, regardless of whether the
 * reference they hold is a name or a key.
 *
 * Type-level disambiguation (two entries sharing a name across types) is out
 * of scope: lockfile `dependencies` lists are plain strings with no type
 * tag, so the last write wins — matching the install-time resolver's own
 * "last-one-wins" name resolution (see `useExistingResolution` in graph.ts).
 */
export function buildNameIndex(lockfile: Lockfile): Map<string, string> {
	const index = new Map<string, string>();
	for (const [key, entry] of Object.entries(lockfile.packages)) {
		index.set(key, key);
		if (entry.name !== undefined && entry.name !== key) {
			index.set(entry.name, key);
		}
	}
	return index;
}

/**
 * Serialize a lockfile to YAML string.
 */
export function serializeLockfile(lockfile: Lockfile): string {
	const header = `# skilltree.lock -- DO NOT EDIT MANUALLY\n# Generated by skilltree v${pkg.version}\n`;
	return header + YAML.stringify(lockfile, { lineWidth: 0 });
}

/**
 * Parse a lockfile from YAML string.
 */
export function parseLockfile(content: string): Lockfile {
	// Strip header comments
	const yamlContent = content
		.split("\n")
		.filter((line) => !line.startsWith("#"))
		.join("\n");
	const raw = YAML.parse(yamlContent) as Lockfile | null;

	if (!raw || typeof raw !== "object") {
		throw new Error("Corrupted lockfile: could not parse YAML");
	}

	// Distinguish "field missing entirely" from "field present but wrong value"
	// (issue #123). Without the name in the error, the user sees
	// `Unsupported lockfile version: undefined` and can't tell whether the key
	// is missing or the value is unrecognized.
	if (raw.lockfile_version === undefined) {
		throw new Error(
			"Invalid lockfile: missing required key `lockfile_version`. Expected `lockfile_version: 1` at the top of the file. Run `skilltree install` to regenerate.",
		);
	}
	if (raw.lockfile_version !== 1) {
		throw new Error(`Unsupported lockfile version: ${raw.lockfile_version}`);
	}

	assertAcyclic(raw);
	return raw;
}

/**
 * The resolver rejects cycles via topological sort before writing a lockfile,
 * so any cycle in `packages` indicates corruption (hand-edit, future
 * skilltree version with a serialization bug, etc.). Validate once on read so
 * downstream consumers (deps tree, install --frozen) can trust acyclicity
 * without re-checking.
 */
function assertAcyclic(lockfile: Lockfile): void {
	const WHITE = 0;
	const GREY = 1;
	const BLACK = 2;
	const color = new Map<string, number>();
	for (const key of Object.keys(lockfile.packages)) color.set(key, WHITE);

	// Resolve child references (entity names) → YAML keys so cycles routed
	// through aliased entries are still caught. See `buildNameIndex`.
	const nameIndex = buildNameIndex(lockfile);

	// Iterative DFS to keep stack depth bounded on deep graphs.
	for (const start of color.keys()) {
		if (color.get(start) !== WHITE) continue;
		// Each frame: [yamlKey, indexOfNextChildToVisit]
		const stack: Array<[string, number]> = [[start, 0]];
		color.set(start, GREY);
		while (stack.length > 0) {
			const top = stack[stack.length - 1];
			if (!top) break;
			const [key, idx] = top;
			const deps = lockfile.packages[key]?.dependencies ?? [];
			if (idx >= deps.length) {
				color.set(key, BLACK);
				stack.pop();
				continue;
			}
			top[1] = idx + 1;
			const childRef = deps[idx];
			if (!childRef) continue;
			const childKey = nameIndex.get(childRef);
			if (!childKey) continue;
			const c = color.get(childKey);
			if (c === GREY) {
				const cycle = [
					...stack.map(([n]) => n).slice(stack.findIndex(([n]) => n === childKey)),
					childKey,
				];
				throw new Error(
					`Lockfile is corrupt: dependency cycle detected: ${cycle.join(" → ")}. The resolver rejects cycles, so this lockfile was hand-edited or written by an incompatible tool. Run 'skilltree install' to regenerate.`,
				);
			}
			if (c === WHITE) {
				color.set(childKey, GREY);
				stack.push([childKey, 0]);
			}
		}
	}
}

/**
 * Read a lockfile from disk. Returns `null` only when the file is absent.
 * Parse errors (corruption, unsupported version, dependency cycle) propagate
 * so callers don't silently fall through to "no lockfile" remediation.
 */
export async function readLockfile(dir: string): Promise<Lockfile | null> {
	const { path } = resolveLockfilePath(dir);
	let content: string;
	try {
		content = await readFile(path, "utf-8");
	} catch (err: unknown) {
		if (err instanceof Error && "code" in err && err.code === "ENOENT") return null;
		throw err;
	}
	return parseLockfile(content);
}

/**
 * Write a lockfile to disk.
 */
export async function writeLockfile(dir: string, lockfile: Lockfile): Promise<void> {
	const { path } = resolveLockfilePath(dir);
	await writeFile(path, serializeLockfile(lockfile), "utf-8");
}

// --- Global lockfile ---

export async function readGlobalLockfile(globalDir?: string): Promise<Lockfile | null> {
	const { path } = resolveGlobalLockfilePath(globalDir);
	let content: string;
	try {
		content = await readFile(path, "utf-8");
	} catch (err: unknown) {
		if (err instanceof Error && "code" in err && err.code === "ENOENT") return null;
		throw err;
	}
	return parseLockfile(content);
}

export async function writeGlobalLockfile(lockfile: Lockfile, globalDir?: string): Promise<void> {
	const { path } = resolveGlobalLockfilePath(globalDir);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, serializeLockfile(lockfile), "utf-8");
}

export interface LockfileDiff {
	unchanged: string[]; // manifest keys present in both, compatible
	added: string[]; // in manifest but not lockfile
	changed: string[]; // in both but repo/version changed
	removed: string[]; // in lockfile but not manifest
	/**
	 * Manifest keys of `pack:` refs whose members are present in the lockfile
	 * (#161). Reported in their own bucket rather than folded into
	 * `unchanged` for two reasons:
	 *
	 *  - Namespace. Every other bucket holds manifest keys; a pack ref's
	 *    members are lockfile keys. Mixing them would make `unchanged` mean
	 *    two different things depending on the entry.
	 *  - Freshness is not provable here. A pack's membership lives in the
	 *    pack host's manifest, which the lockfile does not record, so this
	 *    function cannot tell whether a pack ref still expands to the members
	 *    it expanded to last time. Callers that use the diff to *skip* work
	 *    must treat a non-empty `packs` as "cannot prove current" and
	 *    re-resolve; callers asking "is the lockfile in sync" (doctor,
	 *    `--frozen`) can ignore it.
	 */
	packs: string[];
}

/**
 * Diff a manifest against an existing lockfile.
 * Returns which entries are unchanged, added, changed, removed, or pack refs.
 *
 * Most manifest keys map 1:1 onto a lockfile package of the same name. A
 * `pack:` reference does not: it lives in the manifest under a single key but
 * expands to N packages, each stamped with `via_pack: <that key>` (#153). A
 * name-to-name diff would therefore report the pack key as `added` and every
 * expanded package as `removed` forever — see issue #161, where `doctor`'s
 * lockfile-sync check could never be satisfied on a pack-only project, its
 * "run install to sync" remediation looped, and `install --frozen` / `vendor
 * --frozen` were impossible on any project that used packs. Pack refs are
 * matched through that `via_pack` attribution instead.
 */
export function diffManifestLockfile(manifest: Manifest, lockfile: Lockfile): LockfileDiff {
	const expanded = expandSources(manifest);
	const allManifestDeps: Record<string, Dependency> = {
		...expanded.dependencies,
		...expanded["dev-dependencies"],
	};

	const membersByPack = indexLockfileByPack(lockfile);

	const unchanged: string[] = [];
	const added: string[] = [];
	const changed: string[] = [];
	const removed: string[] = [];
	const packs: string[] = [];

	// Lockfile entries the manifest accounts for: direct deps by name, plus
	// every member a `pack:` ref expanded to. These are the roots for the
	// orphan sweep below — a pack member's transitive deps are as legitimately
	// present as a direct dep's.
	const accounted = new Set<string>();

	for (const [key, dep] of Object.entries(allManifestDeps)) {
		if (isPackDependency(dep)) {
			const members = membersByPack.get(key) ?? [];
			// A pack ref with no expanded members in the lock has never been
			// installed (or its members were dropped) — that IS a real "added".
			if (members.length === 0) {
				added.push(key);
				continue;
			}
			// Every member stays accounted for either way: whether or not the
			// pack matches, its members are explained by this manifest entry
			// and must not be swept up as orphans below.
			for (const member of members) accounted.add(member);

			const recorded = lockfile.pack_resolutions?.[key];
			if (recorded !== undefined && !packResolutionMatches(dep, recorded, members)) {
				changed.push(key);
				continue;
			}
			packs.push(key);
			continue;
		}

		accounted.add(key);
		const locked = lockfile.packages[key];
		if (!locked) {
			added.push(key);
		} else {
			classifyDep(dep, locked, key, unchanged, changed);
		}
	}

	// Lockfile entries that are neither declared nor reachable from something
	// declared are orphans. One traversal from all accounted roots, rather
	// than a fresh walk (and a fresh name index) per candidate.
	const reachable = collectReachable(lockfile, accounted);
	for (const key of Object.keys(lockfile.packages)) {
		if (!reachable.has(key)) removed.push(key);
	}

	return { unchanged, added, changed, removed, packs };
}

/**
 * Does a recorded `pack_resolutions` entry still describe what the manifest
 * asks for, and is what it recorded still actually in the lockfile? (#164)
 *
 * Three ways to disagree, all of which used to read as "in sync" because the
 * old check only asked whether *some* member survived:
 *
 *  - the pack was renamed under a stable yaml key (`pack:` changed),
 *  - the pack was retargeted to a different repo,
 *  - the recorded member set and the lockfile's actual members diverged
 *    (a dropped entry, or a stray one claiming this pack's attribution).
 *
 * What it deliberately does NOT prove: that the *upstream* pack definition
 * still expands to this member set. That lives in the pack host's manifest,
 * which is not in the lockfile — hence `install` still re-resolves packs
 * rather than trusting a match here. See `LockfileDiff.packs`.
 */
function packResolutionMatches(
	dep: PackDependency,
	recorded: PackResolution,
	actualMembers: string[],
): boolean {
	if (recorded.pack !== dep.pack) return false;
	// Recorded-vs-declared, both possibly absent — a local pack has neither.
	if (recorded.repo !== dep.repo) return false;

	// Set comparison, not array: member order in the lockfile is not
	// meaningful, and `actualMembers` comes from object iteration order.
	if (recorded.members.length !== actualMembers.length) return false;
	const expected = new Set(recorded.members);
	return actualMembers.every((member) => expected.has(member));
}

/**
 * Group lockfile package keys by the `via_pack` attribution the installer
 * stamped on them (#153). The value is the consumer's YAML key for the pack
 * ref, not the pack's own name, so it is compared against manifest keys.
 *
 * Entries without attribution — and entries whose attribution is a blank
 * string, which is a hand-edited value rather than an absence (see "Presence
 * check ≠ value check" in CLAUDE.md) — are omitted, so they can never satisfy
 * a pack reference.
 */
function indexLockfileByPack(lockfile: Lockfile): Map<string, string[]> {
	const byPack = new Map<string, string[]>();
	for (const [key, entry] of Object.entries(lockfile.packages)) {
		const pack = entry.via_pack;
		if (pack === undefined || pack === "") continue;
		const members = byPack.get(pack) ?? [];
		members.push(key);
		byPack.set(pack, members);
	}
	return byPack;
}

/**
 * Build ResolvedEntity map + resolution context from a lockfile.
 * Shared between frozenInstall and resolveFromLockfile to avoid duplication.
 */
export function entitiesFromLockfile(lockfile: Lockfile): {
	entities: Map<string, ResolvedEntity>;
	resolutionContext: Map<string, string>;
} {
	const entities = new Map<string, ResolvedEntity>();
	const resolutionContext = new Map<string, string>();

	for (const [key, entry] of Object.entries(lockfile.packages)) {
		const compositeKey = `${entry.type}:${entry.name ?? key}`;
		const isLocal = entry.source === "local";
		const entryPath = expandTilde(entry.path);

		entities.set(compositeKey, {
			key,
			name: entry.name ?? key,
			type: entry.type,
			group: entry.group,
			repo: entry.repo,
			path: entryPath,
			version: entry.version,
			commit: entry.commit,
			local: isLocal,
			dependencies: entry.dependencies,
		});
		resolutionContext.set(entry.name ?? key, compositeKey);
	}

	return { entities, resolutionContext };
}

function classifyDep(
	dep: Dependency,
	locked: LockfileEntry,
	key: string,
	unchanged: string[],
	changed: string[],
): void {
	if (isLocalDependency(dep)) {
		unchanged.push(key);
		return;
	}
	if (isRemoteDependency(dep)) {
		if (dep.repo !== locked.repo) {
			changed.push(key);
			return;
		}
		const constraint = dep.version ?? "*";
		if (locked.version && constraint !== "*" && !semver.satisfies(locked.version, constraint)) {
			changed.push(key);
			return;
		}
	}
	unchanged.push(key);
}

/**
 * Every lockfile key reachable from `roots`, following each entry's
 * `dependencies`. Roots that aren't themselves lockfile keys are harmless —
 * only keys that exist in `lockfile.packages` are ever queried.
 */
function collectReachable(lockfile: Lockfile, roots: Set<string>): Set<string> {
	// `entry.dependencies` references children by name; resolve to YAML keys
	// via the name index. See `buildNameIndex`.
	const nameIndex = buildNameIndex(lockfile);
	const reachable = new Set<string>();
	const stack = [...roots];

	while (stack.length > 0) {
		const key = stack.pop();
		if (key === undefined || reachable.has(key)) continue;
		reachable.add(key);
		const entry = lockfile.packages[key];
		if (!entry) continue;
		for (const dep of entry.dependencies) {
			const depKey = nameIndex.get(dep);
			if (depKey !== undefined && !reachable.has(depKey)) stack.push(depKey);
		}
	}
	return reachable;
}
