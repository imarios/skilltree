import { join } from "node:path";
import {
	AGENT_REGISTRY,
	getAgentLabel,
	resolveGlobalTarget,
	resolveTarget,
} from "../core/agents.js";
import { isSingleFileEntity } from "../core/entity-type.js";
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
	warnLegacyInstallPath,
} from "../core/manifest.js";
import { collapseTilde, expandTilde, getGlobalDir, getGlobalInstallBase } from "../core/paths.js";
import {
	dim,
	error,
	header,
	pc,
	pluralize,
	success,
	throwOnResolutionErrors,
	warn,
} from "../core/ui.js";
import type { EntityType, Lockfile, Manifest } from "../types.js";
import { isLocalDependency } from "../types.js";

export interface InstallCommandOptions extends InstallOptions {
	global?: boolean;
	globalDir?: string; // test override
}

/**
 * Single line for one entity in the "Install order" listing.
 * Pure formatting helper — shared by the resolution-based and plan-based callers.
 */
function formatInstallOrderLine(index: number, entity: ResolvedEntity): string {
	const version = entity.version ? pc.green(`@${entity.version}`) : "";
	const source = entity.local ? dim("local") : dim(entity.repo ?? "");
	return `  ${pc.bold(`${index + 1}.`)} ${entity.type}:${pc.cyan(entity.name)}${version} ${dim(`(${source})`)}`;
}

/**
 * Print the install order from a plan. Used by the (single-target) frozen path.
 */
function printInstallOrderFromPlan(plan: InstallPlan): void {
	header("\nInstall order:");
	for (let i = 0; i < plan.toInstall.length; i++) {
		const item = plan.toInstall[i];
		if (!item) continue;
		console.log(formatInstallOrderLine(i, item.entity));
	}
}

/**
 * Print the install order from a resolution result. The order is target-agnostic
 * (it's determined by the dependency graph, not the install location), so this
 * is printed exactly once regardless of how many install targets there are.
 *
 * Skips entities filtered out by `--prod` so the listing matches what will
 * actually be installed.
 */
function printInstallOrderFromResolution(
	result: { entities: Map<string, ResolvedEntity>; installOrder: string[] },
	options: InstallOptions,
): void {
	header("\nInstall order:");
	let i = 0;
	for (const compositeKey of result.installOrder) {
		const entity = result.entities.get(compositeKey);
		if (!entity) continue;
		if (options.prod && entity.group === "dev") continue;
		console.log(formatInstallOrderLine(i, entity));
		i++;
	}
}

interface TargetInfo {
	/** Absolute path where files are written. */
	installBase: string;
	/** Relative directory shown to the user (e.g., ".claude" or "./vendor/foo"). */
	displayDir: string;
	/** Friendly agent label for known agents, or null for literal paths / overrides. */
	label: string | null;
}

/**
 * Build TargetInfo for project install. Mirrors `getInstallTargets()` but
 * preserves the raw target name so we can recover the friendly agent label.
 *
 * - `install_targets` entries go through the agent registry (so "claude" → ".claude").
 * - Legacy `dev_install_path` / `install_path` are literal paths and are passed
 *   through unchanged (they are not agent registry keys).
 */
function buildProjectTargets(manifest: Manifest, dir: string): TargetInfo[] {
	if (manifest.install_targets) {
		return manifest.install_targets.map((raw) => {
			const displayDir = resolveTarget(raw);
			return {
				installBase: join(dir, displayDir),
				displayDir,
				label: getAgentLabel(raw),
			};
		});
	}
	const legacy = manifest.dev_install_path ?? manifest.install_path ?? ".claude";
	return [
		{
			installBase: join(dir, legacy),
			displayDir: legacy,
			label: null,
		},
	];
}

/**
 * Build TargetInfo for global install. Same shape as the project variant but
 * `displayDir` keeps the `~/...` form for readable output.
 */
function buildGlobalTargets(manifest: Manifest): TargetInfo[] {
	const rawTargets = manifest.install_targets ?? [];
	if (rawTargets.length === 0) {
		const fallback = getGlobalInstallBase();
		return [{ installBase: fallback, displayDir: fallback, label: null }];
	}
	return rawTargets.map((raw) => {
		// For known agents, show the unexpanded `~/...` form so output is portable.
		const registryEntry = AGENT_REGISTRY[raw];
		return {
			installBase: resolveGlobalTarget(raw),
			displayDir: registryEntry?.globalHome ?? raw,
			label: getAgentLabel(raw),
		};
	});
}

/**
 * Pluralized count by entity type, e.g. "5 skills + 2 agents + 1 command".
 * Returns "0 skills" when the plan is empty so the line still reads naturally.
 */
function formatEntityCounts(plan: InstallPlan): string {
	const counts: Record<EntityType, number> = { skill: 0, agent: 0, command: 0 };
	for (const item of plan.toInstall) {
		counts[item.entity.type]++;
	}

	const parts: string[] = [];
	const order: EntityType[] = ["skill", "agent", "command"];
	for (const type of order) {
		const n = counts[type];
		if (n === 0) continue;
		parts.push(`${n} ${pluralize(type, n)}`);
	}
	if (parts.length === 0) return "0 skills";
	return parts.join(" + ");
}

/**
 * Build the per-target "Installing agent knowledge for X… (.claude/) — N skills" line.
 */
function formatPerTargetLine(target: TargetInfo, plan: InstallPlan): string {
	const counts = formatEntityCounts(plan);
	const dir = dim(`(${target.displayDir})`);
	if (target.label) {
		return `Installing agent knowledge for ${pc.bold(target.label)}… ${dir} — ${counts}`;
	}
	return `Installing into ${pc.bold(target.displayDir)}… — ${counts}`;
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
	warnLegacyInstallPath(manifest);

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

	// Determine install targets — preserves agent labels for friendly per-target output.
	const targets: TargetInfo[] = options.installPath
		? [{ installBase: options.installPath, displayDir: options.installPath, label: null }]
		: buildProjectTargets(manifest, dir);

	// Print install order once — it's the same across targets.
	printInstallOrderFromResolution(result, options);

	const srcInstallBase = manifest.src_install_path ? join(dir, manifest.src_install_path) : null;
	const integrityMap = await installToTargets(result, targets, srcInstallBase, dir, options);

	if (options.dryRun) return;

	warnStaleTargets(existingLockfile, getInstallTargets(manifest));

	const lockfile = buildLockfile(result.entities);
	// Only record install_targets in the lockfile when the user actually set
	// them — mirrors the global path. Otherwise a legacy `dev_install_path`
	// manifest gets a synthetic `install_targets: [".claude"]` written to disk.
	if (manifest.install_targets) {
		lockfile.install_targets = getInstallTargets(manifest);
	}
	applyIntegrityHashes(lockfile, integrityMap, existingLockfile);
	await writeLockfile(dir, lockfile);
	console.log(dim("Updated skilltree.lock"));
	success("Done.");
}

async function installToTargets(
	result: { entities: Map<string, ResolvedEntity>; installOrder: string[] },
	targets: TargetInfo[],
	srcInstallBase: string | null,
	dir: string,
	options: InstallOptions,
): Promise<Map<string, string>> {
	let integrityMap: Map<string, string> = new Map();
	let skippedReported = false;

	for (const target of targets) {
		const primaryBase = options.prod && srcInstallBase ? srcInstallBase : target.installBase;
		const plan = await planInstall(result.entities, result.installOrder, primaryBase, options);

		// `--prod` skips are target-agnostic — report once, not once per target.
		if (plan.skipped.length > 0 && !skippedReported) {
			console.log(dim(`\nSkipped ${plan.skipped.length} dev dependencies (--prod)`));
			skippedReported = true;
		}

		if (options.dryRun) {
			console.log(`\n${formatPerTargetLine(target, plan)} ${dim("(dry run)")}`);
			continue;
		}

		console.log(`\n${formatPerTargetLine(target, plan)}`);
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

	const manifest = await loadManifestOrThrow("", { global: true, globalDir });
	validateManifestOrThrow(manifest, true);

	const targets = buildGlobalTargets(manifest);

	const existingLockfile = await readGlobalLockfile(globalDir);

	if (options.frozen) {
		if (!existingLockfile) {
			throw new Error("--frozen requires a lockfile. Run `skilltree install --global` first.");
		}
		await frozenInstall(manifest, existingLockfile, globalDir, {
			...options,
			installPath: targets[0]?.installBase,
		});
		return;
	}

	const result = await resolveWithLockfile(manifest, existingLockfile, globalDir, "Global ");
	throwOnResolutionErrors(result);

	// Print install order once — shared across all targets.
	printInstallOrderFromResolution(result, options);

	const integrityMap = await installToTargets(result, targets, null, globalDir, options);

	if (options.dryRun) return;

	const lockfile = buildLockfile(result.entities, { global: true });
	if (manifest.install_targets) {
		lockfile.install_targets = getInstallTargets(manifest, { global: true });
	}
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

	printInstallOrderFromPlan(plan);

	// Reconstruct a TargetInfo so frozen output matches the regular install line.
	const target = frozenTarget(primaryBase, dir, manifest);

	if (options.dryRun) {
		console.log(`\n${formatPerTargetLine(target, plan)} ${dim("(dry run)")}`);
		return;
	}

	console.log(`\n${formatPerTargetLine(target, plan)}`);
	await executeInstall(plan, dir, options);
	success("Done.");
}

/**
 * Best-effort TargetInfo for the single-target frozen path. Used to format
 * the per-target line consistently with the regular install path.
 *
 * `displayDir` precedence:
 *   1. Strip a leading `${dir}/` prefix when the install base is under the
 *      project root → readable relative path like `.claude`.
 *   2. Fall back to `~/...` form via collapseTilde for absolute paths under
 *      the user's home (covers global frozen, where `dir` is `~/.skilltree`
 *      but installBase is `~/.claude`).
 *   3. Otherwise show the absolute path verbatim — the user passed it.
 */
function frozenTarget(installBase: string, dir: string, manifest: Manifest): TargetInfo {
	const raw = manifest.install_targets?.[0];
	const label = raw ? getAgentLabel(raw) : null;
	let displayDir: string;
	if (installBase.startsWith(`${dir}/`)) {
		displayDir = installBase.slice(dir.length + 1);
	} else {
		displayDir = collapseTilde(installBase);
	}
	return { installBase, displayDir, label };
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
			const fmPath = isSingleFileEntity(entry.type) ? localPath : `${localPath}/SKILL.md`;
			// readFile is sync-compatible here since we imported it at the top
			const fs = require("node:fs") as typeof import("node:fs");
			const content = fs.readFileSync(fmPath, "utf-8");
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
