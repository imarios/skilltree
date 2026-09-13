import { lstat, readlink, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
