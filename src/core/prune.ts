import type { Dirent } from "node:fs";
import { lstat, readdir, readlink, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { EntityType, Lockfile, LockfileEntry } from "../types.js";
import { computeIntegrity, getTargetPath } from "./installer.js";
import { installedName } from "./lockfile.js";
import { expandTilde } from "./paths.js";
import { dim, warn } from "./ui.js";

/**
 * Prune entities that left the manifest (#205), the way npm prunes packages
 * that are no longer depended on.
 *
 * Deciding what is safe to delete needs two facts, and both must hold:
 *
 * 1. **The previous lockfile says skilltree installed it.** Only its entries
 *    are candidates, so nothing skilltree didn't install — a skill placed by
 *    hand, another tool's links — is ever considered. With no previous
 *    lockfile there is no record, and nothing is pruned.
 * 2. **What is on disk is still what skilltree put there.** A symlink must
 *    still point at the recorded source; a copy must still match the recorded
 *    integrity hash. Otherwise the entity is kept with a warning, unless the
 *    caller asked to remove modified orphans too (`install --force`).
 *
 * Orphans are matched by type and installed name, not by lockfile key:
 * renaming an alias drops the old key but installs the same `skills/<name>`,
 * which must not be deleted straight after being written.
 */
export interface PruneOptions {
	/** Directory the lockfile's local paths are relative to (project or global dir). */
	baseDir: string;
	/** Every install base the entities were installed into. */
	installBases: string[];
	dryRun?: boolean;
	/** Also remove orphans whose files no longer match what was installed. */
	removeModified?: boolean;
}

type Ownership = "owned" | "modified" | "unverifiable" | "foreign" | "absent";

export async function pruneRemovedEntities(
	previous: Lockfile | null,
	current: Iterable<{ type: EntityType; name: string }>,
	options: PruneOptions,
): Promise<void> {
	if (previous === null) return;

	const stillInstalled = new Set<string>();
	for (const entity of current) {
		stillInstalled.add(`${entity.type}:${entity.name}`);
	}

	const orphans = Object.entries(previous.packages)
		.map(([key, entry]) => ({ name: installedName(key, entry), entry }))
		.filter(({ name, entry }) => !stillInstalled.has(`${entry.type}:${name}`))
		.sort((a, b) => a.name.localeCompare(b.name));

	for (const { name, entry } of orphans) {
		for (const installBase of options.installBases) {
			const targetPath = getTargetPath({ name, type: entry.type }, installBase);
			const state = await ownership(targetPath, entry, options.baseDir);
			if (state === "absent") continue;

			if (state !== "owned" && options.removeModified !== true) {
				warn(keptMessage(name, targetPath, state));
				continue;
			}

			if (options.dryRun === true) {
				console.log(dim(`Would remove ${name}: no longer a dependency (${targetPath})`));
				continue;
			}

			try {
				// On a symlink this removes the link, never the source it points at.
				await rm(targetPath, { recursive: true, force: true });
				console.log(dim(`Removed ${name}: no longer a dependency (${targetPath})`));
			} catch (err) {
				warn(
					`Could not remove ${name} at ${targetPath}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	}
}

async function ownership(
	targetPath: string,
	entry: LockfileEntry,
	baseDir: string,
): Promise<Ownership> {
	let stats: Awaited<ReturnType<typeof lstat>>;
	try {
		stats = await lstat(targetPath);
	} catch {
		return "absent";
	}

	if (stats.isSymbolicLink()) {
		const expected = resolve(baseDir, expandTilde(entry.path));
		const actual = resolve(dirname(targetPath), await readlink(targetPath));
		return actual === expected ? "owned" : "foreign";
	}

	if (entry.integrity === undefined) return "unverifiable";
	return (await computeIntegrity(targetPath)) === entry.integrity ? "owned" : "modified";
}

function keptMessage(
	name: string,
	targetPath: string,
	state: Exclude<Ownership, "owned" | "absent">,
): string {
	const why = {
		modified: "its files have local changes",
		unverifiable: "there is no integrity record to confirm its files are unchanged",
		foreign: "it is now a link to something skilltree did not install",
	}[state];
	return `Kept ${name} at ${targetPath}: it is no longer a dependency, but ${why}. Run \`skilltree install --force\` to remove it.`;
}

/**
 * Entries in the install tree that skilltree did not install (#205): on disk
 * under `skills/`, `agents/` or `commands/`, but not in the lockfile.
 *
 * The counterpart of pruning. Pruning only removes what the lockfile records,
 * so leftovers from before there was a lockfile, or skills placed by hand,
 * would otherwise be invisible. These are reported, never removed: a
 * hand-placed skill is a legitimate thing to have. Dotfiles and files that
 * are not entities (a skill is a directory; agents and commands are `.md`) are
 * ignored. Names are matched through `installedName`, so an aliased entity is
 * recognised under the name it is installed as.
 */
export async function findExtraneous(
	lockfile: Lockfile,
	installBases: string[],
): Promise<Array<{ name: string; type: EntityType; path: string }>> {
	const managed = new Set(
		Object.entries(lockfile.packages).map(
			([key, entry]) => `${entry.type}:${installedName(key, entry)}`,
		),
	);

	const found: Array<{ name: string; type: EntityType; path: string }> = [];
	for (const installBase of installBases) {
		for (const [subdir, type] of ENTITY_DIRS) {
			for (const entry of await listDir(join(installBase, subdir))) {
				const name = entityName(entry, type);
				if (name === null || managed.has(`${type}:${name}`)) continue;
				found.push({ name, type, path: join(installBase, subdir, entry.name) });
			}
		}
	}
	return found.sort((a, b) => a.path.localeCompare(b.path));
}

const ENTITY_DIRS: ReadonlyArray<readonly [string, EntityType]> = [
	["skills", "skill"],
	["agents", "agent"],
	["commands", "command"],
];

/** A directory's entries, or none when it doesn't exist. */
async function listDir(path: string): Promise<Dirent[]> {
	try {
		return await readdir(path, { withFileTypes: true });
	} catch {
		return [];
	}
}

/**
 * The entity name an install-tree entry stands for, or null when it isn't one:
 * a skill is a directory (or a link to one), agents and commands are `.md`
 * files (or links to them), and dotfiles are never entities.
 */
function entityName(entry: Dirent, type: EntityType): string | null {
	if (entry.name.startsWith(".")) return null;
	if (type === "skill") {
		return entry.isDirectory() || entry.isSymbolicLink() ? entry.name : null;
	}
	const isMarkdown = (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md");
	return isMarkdown ? entry.name.slice(0, -".md".length) : null;
}
