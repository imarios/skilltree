/**
 * Neon Phase 2 (#203) FR10: `freeze --global` / `unfreeze --global` edit the
 * global manifest and lockfile, not a project's.
 *
 * Global installs land under `~/.claude`, which the test preload points at a
 * sandboxed `$HOME` (tests/setup/sandbox-home.ts).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { freezeCommand, unfreezeCommand } from "../../src/commands/freeze.js";
import { installCommand } from "../../src/commands/install.js";
import { readGlobalLockfile } from "../../src/core/lockfile.js";
import { readGlobalManifest, writeGlobalManifest } from "../../src/core/manifest.js";
import { addTagToRepo, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string | undefined;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
	tempDir = undefined;
});

async function globalInstall(): Promise<{ cwd: string; globalDir: string }> {
	const dir = await mkdtemp(join(tmpdir(), "skilltree-freeze-global-"));
	tempDir = dir;
	const skills = [{ path: "skills/stable", name: "stable" }];
	const repoDir = await createTestRepo(dir, "upstream", skills, "v0.4.0");
	const bareDir = join(dir, "upstream.git");
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	await addTagToRepo(repoDir, bareDir, "v0.6.0", skills);

	const cwd = join(dir, "anywhere");
	const globalDir = join(dir, "global");
	await mkdir(cwd, { recursive: true });
	await writeGlobalManifest(
		{
			dependencies: {
				stable: { repo: `file://${bareDir}`, path: "skills/stable", type: "skill", version: "*" },
			},
		},
		globalDir,
	);
	await installCommand(cwd, { global: true, globalDir });
	return { cwd, globalDir };
}

describe("freeze --global (#203)", () => {
	test("FR10 freeze and unfreeze edit the global manifest and lockfile", async () => {
		const { cwd, globalDir } = await globalInstall();

		await freezeCommand(cwd, "stable", "0.4.0", { global: true, globalDir });

		const frozenEntry = (await readGlobalManifest(globalDir)).dependencies?.stable as {
			frozen?: string;
		};
		expect(frozenEntry.frozen).toBe("0.4.0");
		const frozenLock = (await readGlobalLockfile(globalDir))?.packages.stable;
		expect(frozenLock?.version).toBe("0.4.0");
		expect(frozenLock?.frozen).toBe("0.4.0");

		await unfreezeCommand(cwd, "stable", { global: true, globalDir });

		const unfrozenEntry = (await readGlobalManifest(globalDir)).dependencies?.stable as {
			frozen?: string;
		};
		expect(unfrozenEntry.frozen).toBeUndefined();
		expect((await readGlobalLockfile(globalDir))?.packages.stable?.version).toBe("0.6.0");
	});
});
