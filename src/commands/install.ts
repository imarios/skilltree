import { join } from "node:path";
import { getDeclaredDeps, parseFrontmatter } from "../core/frontmatter.js";
import { ensureCached, getCommitSha } from "../core/git.js";
import type { ResolvedEntity } from "../core/graph.js";
import { resolveAll, topologicalSort } from "../core/graph.js";
import type { InstallOptions, InstallPlan } from "../core/installer.js";
import { applyIntegrityHashes, executeInstall, planInstall } from "../core/installer.js";
import {
	buildLockfile,
	diffManifestLockfile,
	entitiesFromLockfile,
	readGlobalLockfile,
	readLockfile,
	writeGlobalLockfile,
	writeLockfile,
} from "../core/lockfile.js";
import {
	expandSources,
	getDevInstallPath,
	getInstallTargets,
	loadManifestOrThrow,
	validateManifestOrThrow,
} from "../core/manifest.js";
import { expandTilde, getGlobalDir, getGlobalInstallBase } from "../core/paths.js";
import { dim, error, header, pc, success, throwOnResolutionErrors, warn } from "../core/ui.js";
import type { Lockfile, Manifest } from "../types.js";
import { isLocalDependency } from "../types.js";

export interface InstallCommandOptions extends InstallOptions {
	global?: boolean;
	globalDir?: string; // test override
}

function printInstallOrder(plan: InstallPlan): void {
	header("\nInstall order:");
	for (let i = 0; i < plan.toInstall.length; i++) {
		const item = plan.toInstall[i];
		if (!item) continue;
		const version = item.entity.version ? pc.green(`@${item.entity.version}`) : "";
		const source = item.entity.local ? dim("local") : dim(item.entity.repo ?? "");
		console.log(
			`  ${pc.bold(`${i + 1}.`)} ${item.entity.type}:${pc.cyan(item.entity.name)}${version} ${dim(`(${source})`)}`,
		);
	}
}

export async function installCommand(dir: string, options: InstallCommandOptions): Promise<void> {
	if (options.global) {
		return installGlobal(options);
	}

	const manifest = await loadManifestOrThrow(dir);

	// Vendor mode guard
	if (manifest.vendor && !options.force) {
		warn("Vendor mode is active. Vendored files in .claude/ are committed to git.");
		console.log(`\n  To update vendored files:  ${pc.cyan("skilltree vendor")}`);
		console.log(`  To exit vendor mode:       ${pc.cyan("skilltree unvendor")}\n`);
		console.log("No changes made.");
		return;
	}

	validateManifestOrThrow(manifest);

	const existingLockfile = await readLockfile(dir);

	if (options.frozen) {
		if (!existingLockfile) {
			throw new Error("--frozen requires a lockfile. Run `skilltree install` first.");
		}
		await frozenInstall(manifest, existingLockfile, dir, options);
		return;
	}

	const result = await resolveWithLockfile(manifest, existingLockfile, dir);
	throwOnResolutionErrors(result);

	// Determine install targets
	const resolvedTargets = options.installPath
		? [options.installPath]
		: getInstallTargets(manifest).map((t) => join(dir, t));

	const srcInstallBase = manifest.src_install_path ? join(dir, manifest.src_install_path) : null;
	const integrityMap = await installToTargets(
		result,
		resolvedTargets,
		srcInstallBase,
		dir,
		options,
	);

	if (options.dryRun) return;

	warnStaleTargets(existingLockfile, getInstallTargets(manifest));

	const lockfile = buildLockfile(result.entities);
	lockfile.install_targets = getInstallTargets(manifest);
	applyIntegrityHashes(lockfile, integrityMap, existingLockfile);
	await writeLockfile(dir, lockfile);
	console.log(dim("Updated skilltree.lock"));
	success("Done.");
}

async function installToTargets(
	result: { entities: Map<string, ResolvedEntity>; installOrder: string[] },
	targets: string[],
	srcInstallBase: string | null,
	dir: string,
	options: InstallOptions,
): Promise<Map<string, string>> {
	let integrityMap: Map<string, string> = new Map();

	for (const installBase of targets) {
		const primaryBase = options.prod && srcInstallBase ? srcInstallBase : installBase;
		const plan = await planInstall(result.entities, result.installOrder, primaryBase, options);

		printInstallOrder(plan);

		if (plan.skipped.length > 0) {
			console.log(dim(`\nSkipped ${plan.skipped.length} dev dependencies (--prod)`));
		}

		if (options.dryRun) {
			console.log(pc.yellow("\nDry run — no files written."));
			continue;
		}

		console.log(`\nInstalling ${pc.bold(String(plan.toInstall.length))} entities...`);
		integrityMap = await executeInstall(plan, dir, options);

		if (srcInstallBase && !options.prod) {
			const srcOptions: InstallOptions = { ...options, prod: true, installPath: srcInstallBase };
			const srcPlan = await planInstall(
				result.entities,
				result.installOrder,
				srcInstallBase,
				srcOptions,
			);
			if (srcPlan.toInstall.length > 0) {
				await executeInstall(srcPlan, dir, srcOptions);
			}
		}

		for (const warning of plan.warnings) {
			warn(warning);
		}
	}

	return integrityMap;
}

function warnStaleTargets(existingLockfile: Lockfile | null, currentTargets: string[]): void {
	if (!existingLockfile?.install_targets) return;
	for (const oldTarget of existingLockfile.install_targets) {
		if (!currentTargets.includes(oldTarget)) {
			warn(
				`stale target ${oldTarget}/ still has installed skills — remove manually if no longer needed`,
			);
		}
	}
}

async function installGlobal(options: InstallCommandOptions): Promise<void> {
	if (options.prod) {
		throw new Error("--prod and --global are incompatible. Global has no prod concept.");
	}
	if (options.installPath) {
		throw new Error(
			"--install-path and --global are incompatible. Global always installs to ~/.claude/.",
		);
	}

	const globalDir = options.globalDir ?? getGlobalDir();
	const installBase = getGlobalInstallBase();

	const manifest = await loadManifestOrThrow("", { global: true, globalDir });
	validateManifestOrThrow(manifest, true);

	const existingLockfile = await readGlobalLockfile(globalDir);

	if (options.frozen) {
		if (!existingLockfile) {
			throw new Error("--frozen requires a lockfile. Run `skilltree install --global` first.");
		}
		await frozenInstall(manifest, existingLockfile, globalDir, {
			...options,
			installPath: installBase,
		});
		return;
	}

	const result = await resolveWithLockfile(manifest, existingLockfile, globalDir, "Global ");
	throwOnResolutionErrors(result);

	const plan = await planInstall(result.entities, result.installOrder, installBase, {
		...options,
	});

	printInstallOrder(plan);

	if (options.dryRun) {
		console.log(pc.yellow("\nDry run — no files written."));
		return;
	}

	console.log(
		`\nInstalling ${pc.bold(String(plan.toInstall.length))} entities to ${dim(installBase)}...`,
	);
	const integrityMap = await executeInstall(plan, globalDir, options);

	const lockfile = buildLockfile(result.entities, { global: true });
	applyIntegrityHashes(lockfile, integrityMap, existingLockfile);
	await writeGlobalLockfile(lockfile, globalDir);
	console.log(dim("Updated global.lock"));
	success("Done.");
}

/**
 * Resolve dependencies with lockfile optimization.
 * Uses lockfile-first strategy: skip resolution when lockfile is current.
 */
async function resolveWithLockfile(
	manifest: Manifest,
	existingLockfile: Lockfile | null,
	dir: string,
	label = "",
): Promise<{
	entities: Map<string, ResolvedEntity>;
	errors: string[];
	warnings: string[];
	installOrder: string[];
}> {
	if (existingLockfile) {
		const diff = diffManifestLockfile(manifest, existingLockfile);
		const hasChanges = diff.added.length > 0 || diff.changed.length > 0 || diff.removed.length > 0;

		if (!hasChanges && !hasLocalDeps(manifest)) {
			console.log(dim(`${label}Lockfile is current. Installing from lockfile...`));
			return resolveFromLockfile(existingLockfile);
		}
		if (!hasChanges) {
			console.log(dim("Re-reading local dependencies..."));
		} else {
			console.log(`${label}Manifest changed. Resolving dependencies...`);
		}
	} else {
		console.log(`Resolving ${label.toLowerCase()}dependencies...`);
	}
	return resolveAll(manifest, dir);
}

/**
 * Frozen install: use lockfile as sole source of truth.
 */
async function frozenInstall(
	manifest: Manifest,
	lockfile: Lockfile,
	dir: string,
	options: InstallOptions,
): Promise<void> {
	verifyFrozenSync(manifest, lockfile);

	console.log(dim("Frozen install — using lockfile..."));

	const { entities, resolutionContext } = entitiesFromLockfile(lockfile);
	const errors = validateFrozenLocalDeps(entities, lockfile, manifest, dir);

	if (errors.length > 0) {
		for (const err of errors) {
			error(err);
		}
		throw new Error("Frozen install failed: lockfile out of sync");
	}

	const sortErrors: string[] = [];
	const installOrder = topologicalSort(entities, resolutionContext, sortErrors);
	if (sortErrors.length > 0) {
		for (const err of sortErrors) {
			error(err);
		}
		throw new Error("Frozen install failed: dependency cycle");
	}

	// Ensure git caches exist for remote deps
	for (const [, entity] of entities) {
		if (!entity.local && entity.repo) {
			entity.cachePath = await ensureCached(entity.repo);
			await getCommitSha(entity.cachePath, entity.commit);
		}
	}

	const devBase = options.installPath ?? join(dir, getDevInstallPath(manifest));
	const srcBase = manifest.src_install_path ? join(dir, manifest.src_install_path) : null;
	const primaryBase = options.prod && srcBase ? srcBase : devBase;
	const plan = await planInstall(entities, installOrder, primaryBase, options);

	printInstallOrder(plan);

	if (options.dryRun) {
		console.log(pc.yellow("\nDry run — no files written."));
		return;
	}

	console.log(`\nInstalling ${pc.bold(String(plan.toInstall.length))} entities...`);
	await executeInstall(plan, dir, options);
	success("Done.");
}

function verifyFrozenSync(manifest: Manifest, lockfile: Lockfile): void {
	const diff = diffManifestLockfile(manifest, lockfile);
	if (diff.added.length > 0) {
		throw new Error(
			`--frozen: manifest has entries not in lockfile: ${diff.added.join(", ")}\nRun \`skilltree install\` to update the lockfile.`,
		);
	}
	if (diff.removed.length > 0) {
		throw new Error(
			`--frozen: lockfile has entries not in manifest: ${diff.removed.join(", ")}\nRun \`skilltree install\` to update the lockfile.`,
		);
	}
}

/**
 * Re-read local dep frontmatter and check for new transitive deps not in lockfile.
 */
function validateFrozenLocalDeps(
	entities: Map<string, ResolvedEntity>,
	lockfile: Lockfile,
	manifest: Manifest,
	dir: string,
): string[] {
	const expanded = expandSources(manifest);
	const allDeps = { ...expanded.dependencies, ...expanded["dev-dependencies"] };
	const errors: string[] = [];
	const resolutionContext = new Map<string, string>();

	// Build context for checking
	for (const [key] of Object.entries(lockfile.packages)) {
		resolutionContext.set(key, key);
	}

	for (const [key, entry] of Object.entries(lockfile.packages)) {
		const manifestDep = allDeps[key];
		const isLocal = entry.source === "local";

		if (!isLocal || !manifestDep || !isLocalDependency(manifestDep)) continue;

		try {
			const expandedLocal = expandTilde(manifestDep.local);
			const localPath = expandedLocal.startsWith("/") ? expandedLocal : `${dir}/${expandedLocal}`;
			const skillMdPath = entry.type === "skill" ? `${localPath}/SKILL.md` : localPath;
			// readFile is sync-compatible here since we imported it at the top
			const fs = require("node:fs") as typeof import("node:fs");
			const content = fs.readFileSync(skillMdPath, "utf-8");
			const fm = parseFrontmatter(content);
			const fmDeps = (fm ? getDeclaredDeps(fm) : []).filter((d) => d !== (entry.name ?? key));

			for (const dep of fmDeps) {
				if (!lockfile.packages[dep] && !resolutionContext.has(dep)) {
					errors.push(
						`--frozen: local dep "${key}" declares new transitive dependency "${dep}" not in lockfile.\nRun \`skilltree install\` to update the lockfile.`,
					);
				}
			}

			// Update entity dependencies from filesystem
			const compositeKey = `${entry.type}:${entry.name ?? key}`;
			const entity = entities.get(compositeKey);
			if (entity) {
				entity.dependencies = fmDeps;
			}
		} catch {
			// Can't read — use lockfile deps
		}
	}

	return errors;
}

/**
 * Build ResolutionResult from a lockfile without running resolution.
 */
async function resolveFromLockfile(lockfile: Lockfile): Promise<{
	entities: Map<string, ResolvedEntity>;
	errors: string[];
	warnings: string[];
	installOrder: string[];
}> {
	const { entities, resolutionContext } = entitiesFromLockfile(lockfile);

	// Ensure git caches exist for remote deps
	for (const [, entity] of entities) {
		if (!entity.local && entity.repo) {
			entity.cachePath = await ensureCached(entity.repo);
		}
	}

	const errors: string[] = [];
	const installOrder = topologicalSort(entities, resolutionContext, errors);
	return { entities, errors, warnings: [], installOrder };
}

function hasLocalDeps(manifest: Manifest): boolean {
	const allDeps = { ...manifest.dependencies, ...manifest["dev-dependencies"] };
	return Object.values(allDeps).some((dep) => isLocalDependency(dep));
}
