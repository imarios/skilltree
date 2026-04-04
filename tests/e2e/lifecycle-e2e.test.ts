import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { addCommand } from "../../src/commands/add.js";
import { initCommand } from "../../src/commands/init.js";
import { installCommand } from "../../src/commands/install.js";
import { removeCommand } from "../../src/commands/remove.js";
import { updateCommand } from "../../src/commands/update.js";
import { verifyCommand } from "../../src/commands/verify.js";
import { parseLockfile } from "../../src/core/lockfile.js";
import { addTagToRepo, createLocalSkill, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-e2e-lifecycle-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function makeBareClone(repoDir: string, baseDir: string, name: string): Promise<string> {
	const bareDir = join(baseDir, `${name}.git`);
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	return bareDir;
}

describe("e2e lifecycle: init → add → install → verify → update → remove", () => {
	test("full lifecycle with local and remote dependencies", async () => {
		const dir = await makeTempDir();

		// ── STEP 1: init ──
		await initCommand(dir);

		// Verify skilltree.yaml created
		const manifest = await readFile(join(dir, "skilltree.yaml"), "utf-8");
		expect(manifest).toContain("dependencies:");
		expect(manifest).toContain("dev-dependencies:");

		// Verify .gitignore updated
		const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
		expect(gitignore).toContain(".claude/skills/");
		expect(gitignore).toContain(".claude/agents/");

		// ── STEP 2: Create repos and local skills ──

		// Remote repo with two skills
		const repoDir = await createTestRepo(
			dir,
			"remote-repo",
			[
				{ path: "skills/base-skill", name: "base-skill" },
				{ path: "skills/top-skill", name: "top-skill", dependencies: ["base-skill"] },
			],
			"v1.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "remote-bare");

		// Local skill
		await createLocalSkill(join(dir, "skills"), "local-skill");

		// ── STEP 3: add dependencies ──
		await addCommand(
			"top-skill",
			{
				repo: `file://${bareDir}`,
				path: "skills/top-skill",
				version: "^1.0.0",
			},
			dir,
		);

		await addCommand(
			"local-skill",
			{
				local: "./skills/local-skill",
			},
			dir,
		);

		// Verify manifest has entries
		const manifestAfterAdd = await readFile(join(dir, "skilltree.yaml"), "utf-8");
		expect(manifestAfterAdd).toContain("top-skill");
		expect(manifestAfterAdd).toContain("local-skill");

		// ── STEP 4: install ──
		await installCommand(dir, {});

		// Verify all installed
		const topStat = await lstat(join(dir, ".claude", "skills", "top-skill"));
		expect(topStat.isDirectory()).toBe(true);
		expect(topStat.isSymbolicLink()).toBe(false); // remote = copy

		const baseStat = await lstat(join(dir, ".claude", "skills", "base-skill"));
		expect(baseStat.isDirectory()).toBe(true); // transitive, auto-resolved from same repo

		const localStat = await lstat(join(dir, ".claude", "skills", "local-skill"));
		expect(localStat.isSymbolicLink()).toBe(true); // local = symlink

		// Verify lockfile has all three
		const lockContent = await readFile(join(dir, "skilltree.lock"), "utf-8");
		const lockfile = parseLockfile(lockContent);
		expect(lockfile.packages["top-skill"]?.version).toBe("1.0.0");
		expect(lockfile.packages["top-skill"]?.dependencies).toContain("base-skill");
		expect(lockfile.packages["base-skill"]?.version).toBe("1.0.0");
		expect(lockfile.packages["local-skill"]?.source).toBe("local");

		// ── STEP 5: verify ──
		// Just make sure it runs without error
		await verifyCommand(dir);

		// ── STEP 6: update ──
		// Add v1.1.0 tag to remote repo
		await addTagToRepo(repoDir, bareDir, "v1.1.0", [
			{ path: "skills/base-skill", name: "base-skill" },
			{ path: "skills/top-skill", name: "top-skill", dependencies: ["base-skill"] },
		]);

		await updateCommand(dir, "top-skill");

		const lockAfterUpdate = parseLockfile(await readFile(join(dir, "skilltree.lock"), "utf-8"));
		expect(lockAfterUpdate.packages["top-skill"]?.version).toBe("1.1.0");
		expect(lockAfterUpdate.packages["base-skill"]?.version).toBe("1.1.0");

		// Verify updated content
		const updatedContent = await readFile(
			join(dir, ".claude", "skills", "top-skill", "SKILL.md"),
			"utf-8",
		);
		expect(updatedContent).toContain("Updated content for v1.1.0");

		// ── STEP 7: remove ──
		await removeCommand("local-skill", dir, { force: true });

		// Verify removed from manifest
		const manifestAfterRemove = await readFile(join(dir, "skilltree.yaml"), "utf-8");
		expect(manifestAfterRemove).not.toContain("local-skill");

		// Verify removed from lockfile
		const lockAfterRemove = parseLockfile(await readFile(join(dir, "skilltree.lock"), "utf-8"));
		expect(lockAfterRemove.packages["local-skill"]).toBeUndefined();

		// Verify files removed
		try {
			await lstat(join(dir, ".claude", "skills", "local-skill"));
			expect(true).toBe(false); // Should not exist
		} catch (e: unknown) {
			expect((e as NodeJS.ErrnoException).code).toBe("ENOENT");
		}

		// Remote deps should still be installed
		const topStillExists = await lstat(join(dir, ".claude", "skills", "top-skill"));
		expect(topStillExists.isDirectory()).toBe(true);

		// ── STEP 8: verify again (should work with remaining deps) ──
		await verifyCommand(dir);
	});
});
