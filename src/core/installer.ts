import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
	chmod,
	cp,
	lstat,
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import simpleGit from "simple-git";
import type { EntityType, Lockfile } from "../types.js";
import { isSingleFileEntity } from "./entity-type.js";
import { readFileAtRef } from "./git.js";
import type { ResolvedEntity } from "./graph.js";
import { IgnoreMatcher } from "./ignore.js";
import { stripDotSlash } from "./paths.js";

export interface InstallOptions {
	prod?: boolean;
	frozen?: boolean;
	force?: boolean;
	dryRun?: boolean;
	installPath?: string;
}

/**
 * Single source of truth for "is this entity filtered out by --prod?".
 * Used by `planInstall` (decides what to install) and the install-order
 * printer (decides what to display) so the two views can never disagree.
 */
export function isSkippedForProd(entity: ResolvedEntity, options: InstallOptions): boolean {
	return Boolean(options.prod) && entity.group === "dev";
}

export interface InstallPlan {
	toInstall: Array<{
		entity: ResolvedEntity;
		action: "symlink" | "copy";
		targetPath: string;
		/**
		 * Commit recorded for this entity in the previous lockfile, if any.
		 * Used by `prepareTarget` to force overwrite when the resolver picked
		 * a different version than the one currently on disk (#119 Bug B).
		 */
		previousCommit?: string;
	}>;
	skipped: string[];
	warnings: string[];
}

/**
 * Compute SHA-256 integrity hash for a directory or file.
 * Lists files recursively, sorts by relative path, concatenates path\0content, hashes.
 */
export async function computeIntegrity(path: string): Promise<string> {
	const hash = createHash("sha256");
	const files = await collectFiles(path);
	files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

	for (const file of files) {
		hash.update(`${file.relativePath}\0${file.content}`);
	}

	return `sha256-${hash.digest("hex")}`;
}

async function collectFiles(
	basePath: string,
	relativeTo?: string,
): Promise<Array<{ relativePath: string; content: string }>> {
	const root = relativeTo ?? basePath;
	const results: Array<{ relativePath: string; content: string }> = [];

	const stats = await lstat(basePath);
	if (stats.isFile()) {
		const content = await readFile(basePath, "utf-8");
		const relativePath = basePath.replace(`${root}/`, "").replace(root, "");
		results.push({ relativePath: relativePath || basename(basePath), content });
		return results;
	}

	if (!stats.isDirectory()) return results;

	const entries = await readdir(basePath, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === ".git") continue;
		const fullPath = join(basePath, entry.name);
		if (entry.isFile()) {
			const content = await readFile(fullPath, "utf-8");
			const relativePath = fullPath.replace(`${root}/`, "");
			results.push({ relativePath, content });
		} else if (entry.isDirectory()) {
			const subFiles = await collectFiles(fullPath, root);
			results.push(...subFiles);
		}
	}

	return results;
}

function basename(path: string): string {
	return path.split("/").pop() ?? path;
}

/**
 * Get the install target path for an entity or lockfile entry.
 *
 * Commands install as single `.md` files under `commands/` (sibling to
 * `agents/` and `skills/`) — matching Claude Code's slash-command layout.
 */
export function getTargetPath(
	entity: { name: string; type: EntityType },
	installBase: string,
): string {
	if (entity.type === "agent") {
		return join(installBase, "agents", `${entity.name}.md`);
	}
	if (entity.type === "command") {
		return join(installBase, "commands", `${entity.name}.md`);
	}
	return join(installBase, "skills", entity.name);
}

/**
 * Apply integrity hashes from an install run to lockfile entries,
 * and preserve hashes from a previous lockfile for skipped entities.
 */
export function applyIntegrityHashes(
	lockfile: Lockfile,
	integrityMap: Map<string, string>,
	existingLockfile?: Lockfile | null,
): void {
	for (const [key, integrity] of integrityMap) {
		if (lockfile.packages[key]) {
			lockfile.packages[key].integrity = integrity;
		}
	}
	if (existingLockfile) {
		for (const [key, entry] of Object.entries(existingLockfile.packages)) {
			if (entry.integrity && lockfile.packages[key] && !lockfile.packages[key].integrity) {
				lockfile.packages[key].integrity = entry.integrity;
			}
		}
	}
}

/**
 * Build an installation plan without executing it.
 */
export async function planInstall(
	entities: Map<string, ResolvedEntity>,
	installOrder: string[],
	installBase: string,
	options: InstallOptions,
	previousLockfile?: Lockfile | null,
): Promise<InstallPlan> {
	const toInstall: InstallPlan["toInstall"] = [];
	const skipped: string[] = [];
	const warnings: string[] = [];

	for (const compositeKey of installOrder) {
		const entity = entities.get(compositeKey);
		if (!entity) continue;

		if (isSkippedForProd(entity, options)) {
			skipped.push(compositeKey);
			continue;
		}

		const targetPath = getTargetPath(entity, installBase);

		// Determine action: symlink for local dev, copy for remote and prod
		let action: "symlink" | "copy";
		if (entity.local && !options.installPath) {
			action = "symlink";
		} else {
			action = "copy";
		}

		const previousCommit = previousLockfile?.packages[entity.key]?.commit;
		toInstall.push({ entity, action, targetPath, previousCommit });
	}

	return { toInstall, skipped, warnings };
}

/**
 * Execute an installation plan.
 */
export async function executeInstall(
	plan: InstallPlan,
	projectDir: string,
	options: InstallOptions,
): Promise<Map<string, string>> {
	const integrityMap = new Map<string, string>();

	// Ensure install directories exist
	const installBase = options.installPath ?? join(projectDir, ".claude");
	await mkdir(join(installBase, "skills"), { recursive: true });
	await mkdir(join(installBase, "agents"), { recursive: true });
	await mkdir(join(installBase, "commands"), { recursive: true });

	// Repo-wide ignore patterns apply to every local entity copy. Read once.
	const repoIgnore = await readRepoIgnore(projectDir);

	for (const item of plan.toInstall) {
		const { entity, action, targetPath, previousCommit } = item;

		const skip = await prepareTarget(targetPath, entity, options, plan, previousCommit);
		if (skip) continue;

		if (action === "symlink") {
			const sourcePath = resolve(projectDir, entity.path);
			await mkdir(dirname(targetPath), { recursive: true });
			await symlink(sourcePath, targetPath);
		} else if (action === "copy") {
			if (entity.local) {
				const sourcePath = resolve(projectDir, entity.path);
				const entityIgnore = new IgnoreMatcher(entity.exclude ?? []);
				await copyEntityFiles(sourcePath, targetPath, entity.type, {
					projectDir,
					entityIgnore,
					repoIgnore,
				});
			} else if (entity.cachePath) {
				await copyFromGitCache(entity, targetPath);
			}
			await setReadOnly(targetPath);
			integrityMap.set(entity.key, await computeIntegrity(targetPath));
		}
	}

	return integrityMap;
}

/**
 * Read `.skilltreeignore` at the repo root, if present. Returns an
 * `IgnoreMatcher` with the file's patterns (and an empty one if absent).
 * Spec: publication_surface.md §PS9–PS11.
 */
async function readRepoIgnore(projectDir: string): Promise<IgnoreMatcher> {
	const path = join(projectDir, ".skilltreeignore");
	if (!existsSync(path)) return new IgnoreMatcher([]);
	try {
		const content = await readFile(path, "utf-8");
		return new IgnoreMatcher(content.split(/\r?\n/));
	} catch {
		return new IgnoreMatcher([]);
	}
}

/**
 * Prepare the target path for installation. Removes existing files/symlinks.
 * Returns true if the item should be skipped (already installed, no --force).
 *
 * When the previous lockfile recorded a different commit than the one we're
 * about to install (e.g. a tighter sibling constraint downgraded the repo —
 * see #119), overwrite is forced so the on-disk content stays in sync with
 * the lockfile. Without this, the installer would warn "already installed"
 * and leave stale content on disk while rewriting the lockfile to the new
 * version — a silent integrity break.
 */
async function prepareTarget(
	targetPath: string,
	entity: ResolvedEntity,
	options: InstallOptions,
	plan: InstallPlan,
	previousCommit?: string,
): Promise<boolean> {
	try {
		const stats = await lstat(targetPath);
		if (stats.isSymbolicLink()) {
			await rm(targetPath);
		} else if (stats.isDirectory() || stats.isFile()) {
			const versionChanged = previousCommit !== undefined && previousCommit !== entity.commit;
			if (!options.force && !entity.local && !versionChanged) {
				plan.warnings.push(`${entity.name} already installed. Use --force to overwrite.`);
				return true;
			}
			await makeWritable(targetPath);
			await rm(targetPath, { recursive: true });
		}
	} catch {
		// Target doesn't exist — that's fine
	}
	return false;
}

interface CopyContext {
	/** Repo root, used to compute repo-relative paths for .skilltreeignore. */
	projectDir: string;
	/** Per-entity exclude patterns (entity-relative). */
	entityIgnore: IgnoreMatcher;
	/** Repo-wide .skilltreeignore patterns (repo-relative). */
	repoIgnore: IgnoreMatcher;
}

/**
 * Copy entity files from a local source, excluding .git directories and
 * any files matching the per-entity `exclude:` or repo-level `.skilltreeignore`
 * patterns. Spec: publication_surface.md §PS17, PS21.
 *
 * For single-file entities (agents, commands) the file IS the entity; the
 * ignore rules don't apply — there's nothing to filter inside a single file.
 */
async function copyEntityFiles(
	sourcePath: string,
	targetPath: string,
	entityType: EntityType,
	ctx: CopyContext,
): Promise<void> {
	if (isSingleFileEntity(entityType)) {
		await mkdir(dirname(targetPath), { recursive: true });
		await cp(sourcePath, targetPath);
		return;
	}

	await mkdir(targetPath, { recursive: true });
	const skipMatchers = ctx.entityIgnore.isEmpty && ctx.repoIgnore.isEmpty;
	await cp(sourcePath, targetPath, {
		recursive: true,
		filter: (src) => {
			if (src.includes("/.git")) return false;
			if (skipMatchers) return true;
			return !shouldExclude(src, sourcePath, ctx);
		},
	});
}

/**
 * Test an absolute source path against both ignore matchers. The entity
 * matcher sees the path relative to the entity root; the repo matcher sees
 * the path relative to the project root. Either match → exclude.
 *
 * Skipped when the path IS the entity root itself — the filter is called
 * on the root once and excluding it would skip the whole copy.
 */
function shouldExclude(src: string, sourcePath: string, ctx: CopyContext): boolean {
	if (src === sourcePath) return false;
	const entityRel = relative(sourcePath, src);
	if (entityRel && !entityRel.startsWith("..") && ctx.entityIgnore.ignores(entityRel)) {
		return true;
	}
	const repoRel = relative(ctx.projectDir, src);
	if (repoRel && !repoRel.startsWith("..") && ctx.repoIgnore.ignores(repoRel)) {
		return true;
	}
	return false;
}

/**
 * Copy files from git cache at a specific ref.
 */
async function copyFromGitCache(entity: ResolvedEntity, targetPath: string): Promise<void> {
	if (!entity.cachePath) return;

	const ref = entity.tag ?? entity.commit;
	const path = stripDotSlash(entity.path);

	try {
		if (isSingleFileEntity(entity.type)) {
			await mkdir(dirname(targetPath), { recursive: true });
			const content = await readFileAtRef(entity.cachePath, ref, path);
			await writeFile(targetPath, content, "utf-8");
		} else {
			await mkdir(targetPath, { recursive: true });
			await copyTreeFromGit(entity.cachePath, ref, path, targetPath);
		}
	} catch (cause) {
		const refLabel = entity.tag ?? entity.commit.slice(0, 8);
		const repo = entity.repo ?? "unknown repo";
		throw new Error(
			`"${entity.name}" not found at path "${entity.path}" in ${repo} at ${refLabel}. It may have been moved or removed.`,
			{ cause },
		);
	}
}

/**
 * Copy a directory tree from a git bare repo using a single `ls-tree -r`
 * call instead of recursive subprocess spawning.
 */
async function copyTreeFromGit(
	cachePath: string,
	ref: string,
	treePath: string,
	targetDir: string,
): Promise<void> {
	const git = simpleGit(cachePath);

	// Single recursive ls-tree: lists all blobs in the subtree at once
	const treeArg = treePath === "." ? ref : `${ref}:${treePath}`;
	const lsOutput = await git.raw(["ls-tree", "-r", treeArg]);

	for (const line of lsOutput.trim().split("\n")) {
		if (!line) continue;
		const match = line.match(/^(\d+)\s+blob\s+[a-f0-9]+\t(.+)$/);
		if (!match) continue;

		const [, , relativePath] = match;
		if (!relativePath) continue;

		const itemPath = treePath === "." ? relativePath : `${treePath}/${relativePath}`;
		const targetItemPath = join(targetDir, relativePath);

		await mkdir(dirname(targetItemPath), { recursive: true });
		const content = await readFileAtRef(cachePath, ref, itemPath);
		await writeFile(targetItemPath, content, "utf-8");
	}
}

/**
 * Make files writable so they can be deleted/overwritten.
 */
async function makeWritable(path: string): Promise<void> {
	const stats = await lstat(path);
	if (stats.isFile()) {
		await chmod(path, 0o644);
	} else if (stats.isDirectory()) {
		await chmod(path, 0o755);
		const entries = await readdir(path, { withFileTypes: true });
		for (const entry of entries) {
			await makeWritable(join(path, entry.name));
		}
	}
}

/**
 * Set read-only permissions (chmod 444 for files).
 * Directories keep 755 so they can be managed (deleted, overwritten).
 */
async function setReadOnly(path: string): Promise<void> {
	const stats = await lstat(path);
	if (stats.isFile()) {
		await chmod(path, 0o444);
	} else if (stats.isDirectory()) {
		const entries = await readdir(path, { withFileTypes: true });
		for (const entry of entries) {
			await setReadOnly(join(path, entry.name));
		}
	}
}

export type VerifyStatus = "ok" | "modified" | "linked" | "missing" | "stale" | "broken";

/**
 * Verify installed entities against lockfile integrity hashes.
 *
 * @param projectDir - The project root directory, used to resolve relative paths
 *   in entity.path for local deps. Pass the global dir for global installs.
 */
export async function verifyInstalled(
	entities: Map<string, ResolvedEntity>,
	installBase: string,
	lockfileIntegrity: Record<string, string>,
	projectDir?: string,
): Promise<Array<{ name: string; status: VerifyStatus }>> {
	const results: Array<{ name: string; status: VerifyStatus }> = [];

	for (const [, entity] of entities) {
		const targetPath = getTargetPath(entity, installBase);

		const status = await checkEntityStatus(entity, targetPath, lockfileIntegrity, projectDir);
		results.push({ name: entity.name, status });
	}

	return results;
}

async function checkEntityStatus(
	entity: ResolvedEntity,
	targetPath: string,
	lockfileIntegrity: Record<string, string>,
	projectDir?: string,
): Promise<VerifyStatus> {
	try {
		const stats = await lstat(targetPath);

		if (stats.isSymbolicLink()) {
			try {
				await stat(targetPath);
				return "linked";
			} catch {
				return "broken";
			}
		}

		const expectedIntegrity = lockfileIntegrity[entity.key];
		if (!expectedIntegrity) return "ok";

		const actualIntegrity = await computeIntegrity(targetPath);
		if (actualIntegrity !== expectedIntegrity) return "modified";

		// Check if vendored local dep is stale (source changed since vendor)
		if (entity.local) {
			try {
				const sourcePath = entity.path.startsWith("/")
					? entity.path
					: resolve(projectDir ?? ".", entity.path);
				const sourceIntegrity = await computeIntegrity(sourcePath);
				if (sourceIntegrity !== expectedIntegrity) return "stale";
			} catch {
				// Can't read source — not stale
			}
		}
		return "ok";
	} catch {
		return "missing";
	}
}
