import { rm } from "node:fs/promises";
import { join } from "node:path";
import { MANIFEST_NEW } from "../core/filenames.js";
import {
	addGitignoreEntries,
	getSkillAgentIgnoreEntries,
	removeGitignoreEntries,
} from "../core/gitignore.js";
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
	getInstallTargets,
	loadManifestOrThrow,
	validateManifestOrThrow,
	writeManifest,
} from "../core/manifest.js";
import { dim, header, pc, success, throwOnResolutionErrors, warn } from "../core/ui.js";
import type { Lockfile } from "../types.js";

export interface VendorOptions {
	frozen?: boolean;
	dryRun?: boolean;
	target?: string;
}

export async function vendorCommand(dir: string, options: VendorOptions): Promise<void> {
	const manifest = await loadManifestOrThrow(dir);
	validateManifestOrThrow(manifest);

	// Resolve vendor target — single target only
	const targets = getInstallTargets(manifest);
	if (targets.length > 1 && !options.target) {
		throw new Error(
			`vendor requires --target <name> when multiple install targets are configured.\nTargets: ${targets.join(", ")}`,
		);
	}
	const devInstallPath = options.target ?? targets[0] ?? getDevInstallPath(manifest);
	const installBase = join(dir, devInstallPath);

	const existingLockfile = await readLockfile(dir);

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

	// Plan install: ALL deps (both groups), ALL as copy (no symlinks)
	// Setting installPath forces copy mode for local deps in planInstall
	const plan = await planInstall(result.entities, result.installOrder, installBase, {
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

	// Set vendor: true in manifest
	manifest.vendor = true;
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

export async function unvendorCommand(dir: string, options?: { force?: boolean }): Promise<void> {
	const manifest = await loadManifestOrThrow(dir);

	if (!manifest.vendor) {
		warn("Vendor mode is not active. No changes made.");
		return;
	}

	const devInstallPath = getDevInstallPath(manifest);
	const installBase = join(dir, devInstallPath);
	const lockfile = await readLockfile(dir);

	if (lockfile) {
		if (!options?.force) {
			await checkModifiedVendoredFiles(lockfile, installBase);
		}
		await deleteVendoredFiles(lockfile, installBase);
		console.log(dim(`Deleted vendored files from ${devInstallPath}/`));
	}

	delete manifest.vendor;
	await writeManifest(dir, manifest);
	console.log(dim(`Updated ${MANIFEST_NEW} (vendor: false)`));

	const ignoreEntries = getSkillAgentIgnoreEntries(devInstallPath);
	const added = await addGitignoreEntries(dir, ignoreEntries);
	if (added.length > 0) {
		console.log(dim(`Updated .gitignore (added ${added.join(", ")})`));
	}

	success(`Unvendored. Run ${pc.cyan("`skilltree install`")} to restore normal mode.`);
}

async function checkModifiedVendoredFiles(lockfile: Lockfile, installBase: string): Promise<void> {
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

	if (modified.length > 0) {
		throw new Error(
			`${modified.length} vendored file${modified.length > 1 ? "s" : ""} modified: ${modified.join(", ")}\nRun \`skilltree vendor\` to overwrite with fresh copies, or \`skilltree unvendor --force\` to discard changes.`,
		);
	}
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
