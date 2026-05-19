import { rm } from "node:fs/promises";
import { join } from "node:path";
import { resolveTarget } from "../core/agents.js";
import { MANIFEST_NEW } from "../core/filenames.js";
import {
	addGitignoreEntries,
	getSkillAgentIgnoreEntries,
	removeGitignoreEntries,
} from "../core/gitignore.js";
import type { ResolvedEntity } from "../core/graph.js";
import { resolveAll } from "../core/graph.js";
import { computeIntegrity, executeInstall, getTargetPath, planInstall } from "../core/installer.js";
import {
	buildLockfile,
	diffManifestLockfile,
	readLockfile,
	writeLockfile,
} from "../core/lockfile.js";
import {
	getDevInstallPath,
	loadManifestOrThrow,
	validateManifestOrThrow,
	warnLegacyInstallPath,
	writeManifest,
} from "../core/manifest.js";
import {
	dim,
	dryRunBanner,
	header,
	pc,
	success,
	throwOnResolutionErrors,
	warn,
} from "../core/ui.js";
import type { Lockfile, Manifest } from "../types.js";

export interface VendorOptions {
	frozen?: boolean;
	dryRun?: boolean;
	target?: string;
}

/**
 * Pick which raw `install_targets` entry a vendor/unvendor invocation should
 * act on. Returns `undefined` for legacy manifests (no `install_targets`),
 * signalling the caller to fall back to `getDevInstallPath`.
 *
 * The contract — same for both commands so users don't have to relearn:
 *
 *   - Multi-target manifest (`install_targets` has 2+ entries):
 *       `--target <name>` is REQUIRED. Without it, error lists the raw
 *       entries the user can pass (e.g. "claude, codex") — NOT the
 *       resolved filesystem paths (".claude", ".agents"), which would
 *       mislead them into typing the wrong thing back at us. (See #69.)
 *
 *   - Single `install_targets` entry: `--target` is optional; if provided
 *       it must match the configured entry.
 *
 *   - Legacy manifest (no `install_targets`, uses `dev_install_path` or
 *       defaults): `--target` is rejected — there are no named targets
 *       to pick from. Returns `undefined`.
 *
 * Throws a user-facing `Error` for any contract violation.
 */
function pickRawTarget(
	manifest: Manifest,
	cmd: "vendor" | "unvendor",
	target: string | undefined,
): string | undefined {
	const rawTargets = manifest.install_targets;

	if (!rawTargets || rawTargets.length === 0) {
		// Legacy manifest — no named targets exist
		if (target !== undefined) {
			throw new Error(
				`${cmd}: --target is only valid when install_targets is configured. This manifest uses the legacy dev_install_path — drop --target or migrate with \`skilltree targets migrate\`.`,
			);
		}
		return undefined;
	}

	if (rawTargets.length > 1 && target === undefined) {
		throw new Error(
			`${cmd} requires --target <name> when multiple install targets are configured.\nConfigured targets: ${rawTargets.join(", ")}`,
		);
	}

	const selected = target ?? rawTargets[0];
	if (selected === undefined) {
		// Unreachable: rawTargets.length >= 1 by the empty-check above, and
		// target is a defined string when taken. Defensive throw keeps the
		// type narrow without leaning on a non-null assertion.
		throw new Error(`${cmd}: no install target available (internal invariant)`);
	}
	assertKnownTarget(cmd, selected, rawTargets);
	return selected;
}

/**
 * Resolve the on-disk install path for a vendor/unvendor invocation.
 *
 * Wraps `pickRawTarget`: returns the resolved path relative to the project
 * root (e.g. ".claude"). For legacy manifests, falls back to
 * `getDevInstallPath()`. See `pickRawTarget` for the full contract.
 */
function resolveVendorTarget(
	manifest: Manifest,
	cmd: "vendor" | "unvendor",
	target: string | undefined,
): string {
	const raw = pickRawTarget(manifest, cmd, target);
	if (raw === undefined) {
		return getDevInstallPath(manifest);
	}
	return resolveTarget(raw);
}

/**
 * Hard-error if `target` isn't one of the manifest's raw `install_targets`
 * entries. Case-sensitive, exact match — matches how the rest of the codebase
 * compares target names (e.g. `resolveTarget` does a strict object lookup).
 *
 * The error message uses raw entries, never resolved paths, so the user can
 * copy-paste a name straight back into `--target`.
 */
function assertKnownTarget(
	cmd: "vendor" | "unvendor",
	target: string,
	rawTargets: readonly string[],
): void {
	if (!rawTargets.includes(target)) {
		throw new Error(
			`${cmd}: unknown target '${target}'. Configured targets: ${rawTargets.join(", ")}`,
		);
	}
}

export async function vendorCommand(dir: string, options: VendorOptions): Promise<void> {
	const manifest = await loadManifestOrThrow(dir);
	validateManifestOrThrow(manifest);
	warnLegacyInstallPath(manifest);

	const rawTarget = pickRawTarget(manifest, "vendor", options.target);
	const devInstallPath =
		rawTarget === undefined ? getDevInstallPath(manifest) : resolveTarget(rawTarget);
	const installBase = join(dir, devInstallPath);

	const existingLockfile = await readLockfile(dir);

	// Issue #108: detect a target switch and clean up the previously-vendored
	// directory before populating the new one. Without this, `vendor --target X`
	// then `vendor --target Y` leaves X's tree orphaned on disk — not gitignored
	// (a previous vendor removed those entries), not referenced by the new
	// lockfile, but still committable via `git add .`. Cleanup is a no-op when
	// the recorded target matches, when there is no recorded target (legacy
	// `vendor: true` boolean), or when nothing was previously vendored.
	const prevTarget = manifest.vendored_target;
	const isTargetSwitch =
		prevTarget !== undefined && rawTarget !== undefined && prevTarget !== rawTarget;
	if (isTargetSwitch && existingLockfile) {
		const prevInstallPath = resolveTarget(prevTarget);
		const prevInstallBase = join(dir, prevInstallPath);
		await deleteVendoredFiles(existingLockfile, prevInstallBase);
		const prevIgnoreEntries = getSkillAgentIgnoreEntries(prevInstallPath);
		await addGitignoreEntries(dir, prevIgnoreEntries);
		console.log(
			dim(`Cleaned up previously vendored ${prevInstallPath}/ (switching to ${devInstallPath}/)`),
		);
	}

	if (options.frozen) {
		if (!existingLockfile) {
			throw new Error("--frozen requires a lockfile. Run `skilltree install` first.");
		}
		const diff = diffManifestLockfile(manifest, existingLockfile);
		if (diff.added.length > 0 || diff.removed.length > 0) {
			throw new Error(
				"--frozen: manifest and lockfile are out of sync. Run `skilltree install` first.",
			);
		}
	}

	console.log("Resolving dependencies...");
	const result = await resolveAll(manifest, dir);
	throwOnResolutionErrors(result);

	// Drop `publish: false` local entities — they're not ready to ship and
	// shouldn't appear in vendored artifacts that consumers will see.
	// dev-dependencies stay (vendor freezes the maintainer's full env).
	// Spec: publication_surface.md §PS20.
	const visibleEntities = filterUnpublishedLocals(result.entities);
	const visibleOrder = result.installOrder.filter((k) => visibleEntities.has(k));

	// Plan install: ALL deps (both groups), ALL as copy (no symlinks)
	// Setting installPath forces copy mode for local deps in planInstall
	const plan = await planInstall(visibleEntities, visibleOrder, installBase, {
		installPath: installBase, // forces copy mode
	});

	header("\nVendor plan:");
	for (let i = 0; i < plan.toInstall.length; i++) {
		const item = plan.toInstall[i];
		if (!item) continue;
		const version = item.entity.version ? pc.green(`@${item.entity.version}`) : "";
		const source = item.entity.local ? dim("local") : dim(item.entity.repo ?? "");
		console.log(
			`  ${pc.bold(`${i + 1}.`)} ${item.entity.type}:${pc.cyan(item.entity.name)}${version} ${dim(`(${source}, copied)`)}`,
		);
	}

	if (options.dryRun) {
		console.log(pc.yellow("\nDry run — no files written."));
		return;
	}

	// Execute: copy everything
	console.log(
		`\nCopying ${pc.bold(String(plan.toInstall.length))} entities to ${dim(installBase)}...`,
	);
	const integrityMap = await executeInstall(plan, dir, {
		installPath: installBase,
		force: true, // overwrite existing
	});

	// Build and write lockfile with integrity hashes
	const lockfile = buildLockfile(result.entities);
	for (const [key, integrity] of integrityMap) {
		if (lockfile.packages[key]) {
			lockfile.packages[key].integrity = integrity;
		}
	}
	await writeLockfile(dir, lockfile);
	console.log(dim("Updated skilltree.lock"));

	// Set vendor: true in manifest. Also record which target was vendored
	// (issue #89) so `unvendor` can clean up the right directory without
	// re-asking the user. Legacy manifests with no named target stay legacy:
	// recording a fabricated name would later trip the "unknown target" check.
	manifest.vendor = true;
	if (rawTarget !== undefined) {
		manifest.vendored_target = rawTarget;
	}
	await writeManifest(dir, manifest);
	console.log(dim(`Updated ${MANIFEST_NEW} (vendor: true)`));

	// Update .gitignore: remove skill/agent ignore entries so they can be committed
	const ignoreEntries = getSkillAgentIgnoreEntries(devInstallPath);
	const removed = await removeGitignoreEntries(dir, ignoreEntries);
	if (removed.length > 0) {
		console.log(dim(`Updated .gitignore (removed ${removed.join(", ")})`));
	}

	success(
		`Vendor complete. Run ${pc.cyan(`\`git add ${devInstallPath}/\``)} to commit vendored files.`,
	);
}

export interface UnvendorOptions {
	force?: boolean;
	dryRun?: boolean;
	target?: string;
}

export async function unvendorCommand(dir: string, options?: UnvendorOptions): Promise<void> {
	const manifest = await loadManifestOrThrow(dir);

	if (!manifest.vendor) {
		warn("Vendor mode is not active. No changes made.");
		return;
	}

	// Cross-check --target against the recorded `vendored_target` (issue #89).
	// Three cases:
	//   - User supplied --target AND a target was recorded that doesn't match
	//     → hard-error. Acting on the user's value would leave the actually-
	//     vendored directory orphaned.
	//   - User omitted --target AND a target was recorded
	//     → use the recorded one. Multi-target manifests no longer need the
	//     user to repeat what skilltree already knows.
	//   - Otherwise (legacy `vendor: true` boolean, no `vendored_target:`)
	//     → fall through to the original resolveVendorTarget contract.
	const recordedTarget = manifest.vendored_target;
	if (
		recordedTarget !== undefined &&
		options?.target !== undefined &&
		options.target !== recordedTarget
	) {
		throw new Error(
			`unvendor: --target '${options.target}' does not match the recorded vendored target '${recordedTarget}'.\nRun \`skilltree unvendor --target ${recordedTarget}\` (or drop --target) to clean up the directory that was actually vendored.`,
		);
	}
	const effectiveTarget = options?.target ?? recordedTarget;

	const devInstallPath = resolveVendorTarget(manifest, "unvendor", effectiveTarget);
	const installBase = join(dir, devInstallPath);
	const lockfile = await readLockfile(dir);

	if (options?.dryRun) {
		// Always surface modified files in dry-run, even with --force — the
		// user is asking "what would happen?", and showing what --force is
		// silently overriding is exactly that. Without --force we phrase it
		// as "would abort"; with --force we phrase it as "would discard".
		dryRunBanner();
		if (lockfile) {
			const modified = await getModifiedVendoredFiles(lockfile, installBase);
			if (modified.length > 0) {
				const list = modified.join(", ");
				const count = `${modified.length} vendored file${modified.length > 1 ? "s" : ""}`;
				if (options?.force) {
					warn(`Would discard modifications to ${count}: ${list}`);
				} else {
					warn(`Real run would abort: ${count} modified: ${list}`);
				}
			}
			console.log(dim(`Would delete vendored files from ${devInstallPath}/`));
		}
		console.log(dim(`Would update ${MANIFEST_NEW} (vendor: false)`));
		const ignoreEntries = getSkillAgentIgnoreEntries(devInstallPath);
		console.log(dim(`Would re-add .gitignore entries: ${ignoreEntries.join(", ")}`));
		return;
	}

	if (lockfile) {
		if (!options?.force) {
			await checkModifiedVendoredFiles(lockfile, installBase);
		}
		await deleteVendoredFiles(lockfile, installBase);
		console.log(dim(`Deleted vendored files from ${devInstallPath}/`));
	}

	delete manifest.vendor;
	delete manifest.vendored_target;
	await writeManifest(dir, manifest);
	console.log(dim(`Updated ${MANIFEST_NEW} (vendor: false)`));

	const ignoreEntries = getSkillAgentIgnoreEntries(devInstallPath);
	const added = await addGitignoreEntries(dir, ignoreEntries);
	if (added.length > 0) {
		console.log(dim(`Updated .gitignore (added ${added.join(", ")})`));
	}

	success(`Unvendored. Run ${pc.cyan("`skilltree install`")} to restore normal mode.`);
}

/**
 * Compare each vendored entry's on-disk integrity against the lockfile.
 * Pure: returns the list of modified entry names, mutates nothing, throws
 * nothing. Both `unvendor` (real run) and `unvendor --dry-run` consume this.
 */
async function getModifiedVendoredFiles(
	lockfile: Lockfile,
	installBase: string,
): Promise<string[]> {
	const modified: string[] = [];
	for (const [key, entry] of Object.entries(lockfile.packages)) {
		if (!entry.integrity) continue;
		const name = entry.name ?? key;
		const targetPath = getTargetPath({ name, type: entry.type }, installBase);
		try {
			const actual = await computeIntegrity(targetPath);
			if (actual !== entry.integrity) {
				modified.push(name);
			}
		} catch {
			// Missing file — not modified, just gone
		}
	}
	return modified;
}

async function checkModifiedVendoredFiles(lockfile: Lockfile, installBase: string): Promise<void> {
	const modified = await getModifiedVendoredFiles(lockfile, installBase);
	if (modified.length > 0) {
		throw new Error(
			`${modified.length} vendored file${modified.length > 1 ? "s" : ""} modified: ${modified.join(", ")}\nRun \`skilltree vendor\` to overwrite with fresh copies, or \`skilltree unvendor --force\` to discard changes.`,
		);
	}
}

/**
 * Drop local entities flagged `publish: false`. Remote entities ride through
 * untouched — publish is the maintainer's signal about THEIR repo, not
 * authoritative for anyone else's. Spec: publication_surface.md §PS20.
 */
function filterUnpublishedLocals(
	entities: Map<string, ResolvedEntity>,
): Map<string, ResolvedEntity> {
	const out = new Map<string, ResolvedEntity>();
	for (const [key, entity] of entities) {
		if (entity.local && entity.publish === false) continue;
		out.set(key, entity);
	}
	return out;
}

async function deleteVendoredFiles(lockfile: Lockfile, installBase: string): Promise<void> {
	for (const [key, entry] of Object.entries(lockfile.packages)) {
		const name = entry.name ?? key;
		const targetPath = getTargetPath({ name, type: entry.type }, installBase);
		try {
			await rm(targetPath, { recursive: true });
		} catch {
			// Already gone
		}
	}
}
