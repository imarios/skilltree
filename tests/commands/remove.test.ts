import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addCommand } from "../../src/commands/add.js";
import { initCommand } from "../../src/commands/init.js";
import { removeCommand } from "../../src/commands/remove.js";
import { readLockfile } from "../../src/core/lockfile.js";
import { readManifest } from "../../src/core/manifest.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-remove-"));
	await initCommand(tempDir);
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("removeCommand", () => {
	test("removes a dependency from manifest", async () => {
		const dir = await setup();
		await addCommand("my-skill", { repo: "github.com/user/repo", path: "skills/my-skill" }, dir);

		await removeCommand("my-skill", dir, { force: true });

		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.["my-skill"]).toBeUndefined();
	});

	test("errors when name is not in manifest", async () => {
		const dir = await setup();

		await expect(removeCommand("nonexistent", dir, { force: true })).rejects.toThrow(
			"not in skilltree.yml",
		);
	});

	test("removes from dev-dependencies", async () => {
		const dir = await setup();
		await addCommand(
			"dev-skill",
			{ repo: "github.com/user/repo", path: "skills/dev-skill", dev: true },
			dir,
		);

		await removeCommand("dev-skill", dir, { force: true });

		const manifest = await readManifest(dir);
		expect(manifest["dev-dependencies"]?.["dev-skill"]).toBeUndefined();
	});

	test("errors on transitive-only dep", async () => {
		const dir = await setup();
		await addCommand("parent", { repo: "github.com/user/repo", path: "skills/parent" }, dir);

		// Write a lockfile with a transitive dep
		await writeFile(
			join(dir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  parent:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/parent\n    version: 1.0.0\n    commit: abc\n    dependencies:\n      - transitive-dep\n  transitive-dep:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/transitive-dep\n    version: 1.0.0\n    commit: abc\n    dependencies: []\n",
		);

		await expect(removeCommand("transitive-dep", dir, { force: true })).rejects.toThrow(
			"transitive dependency",
		);
	});

	test("--force removes even when dependents exist", async () => {
		const dir = await setup();
		await addCommand("base", { repo: "github.com/user/repo", path: "skills/base" }, dir);
		await addCommand("consumer", { repo: "github.com/user/repo", path: "skills/consumer" }, dir);

		// Write lockfile with consumer depending on base
		await writeFile(
			join(dir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  base:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/base\n    version: 1.0.0\n    commit: abc\n    dependencies: []\n  consumer:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/consumer\n    version: 1.0.0\n    commit: abc\n    dependencies:\n      - base\n",
		);

		await removeCommand("base", dir, { force: true });

		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.base).toBeUndefined();
	});

	test("--keep-files leaves installed files in place", async () => {
		const dir = await setup();
		await addCommand("my-skill", { repo: "github.com/user/repo", path: "skills/my-skill" }, dir);

		// Create fake installed files and lockfile
		const installDir = join(dir, ".claude", "skills", "my-skill");
		await mkdir(installDir, { recursive: true });
		await writeFile(join(installDir, "SKILL.md"), "# test\n");
		await writeFile(
			join(dir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  my-skill:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/my-skill\n    version: 1.0.0\n    commit: abc\n    dependencies: []\n",
		);

		await removeCommand("my-skill", dir, { force: true, keepFiles: true });

		// Manifest should be cleaned
		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.["my-skill"]).toBeUndefined();

		// But files should still exist
		const stats = await stat(installDir);
		expect(stats.isDirectory()).toBe(true);
	});

	test("removes installed files and cleans lockfile", async () => {
		const dir = await setup();
		await addCommand("my-skill", { repo: "github.com/user/repo", path: "skills/my-skill" }, dir);

		const installDir = join(dir, ".claude", "skills", "my-skill");
		await mkdir(installDir, { recursive: true });
		await writeFile(join(installDir, "SKILL.md"), "# test\n");
		await writeFile(
			join(dir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  my-skill:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/my-skill\n    version: 1.0.0\n    commit: abc\n    dependencies: []\n",
		);

		await removeCommand("my-skill", dir, { force: true });

		// Files should be gone
		await expect(stat(installDir)).rejects.toThrow();

		// Lockfile should not contain the entry
		const lockfile = await readLockfile(dir);
		expect(lockfile?.packages["my-skill"]).toBeUndefined();
	});

	test("orphan cleanup removes unreachable transitive deps", async () => {
		const dir = await setup();
		await addCommand("parent", { repo: "github.com/user/repo", path: "skills/parent" }, dir);

		// Lockfile: parent -> child -> grandchild
		await writeFile(
			join(dir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  parent:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/parent\n    version: 1.0.0\n    commit: abc\n    dependencies:\n      - child\n  child:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/child\n    version: 1.0.0\n    commit: abc\n    dependencies:\n      - grandchild\n  grandchild:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/grandchild\n    version: 1.0.0\n    commit: abc\n    dependencies: []\n",
		);

		await removeCommand("parent", dir, { force: true });

		const lockfile = await readLockfile(dir);
		expect(lockfile?.packages.parent).toBeUndefined();
		expect(lockfile?.packages.child).toBeUndefined();
		expect(lockfile?.packages.grandchild).toBeUndefined();
	});

	test("orphan cleanup removes installed files of orphans", async () => {
		const dir = await setup();
		await addCommand("parent", { repo: "github.com/user/repo", path: "skills/parent" }, dir);

		// Create installed files for parent and orphan child
		const installBase = join(dir, ".claude");
		await mkdir(join(installBase, "skills", "parent"), { recursive: true });
		await writeFile(join(installBase, "skills", "parent", "SKILL.md"), "# parent\n");
		await mkdir(join(installBase, "skills", "child"), { recursive: true });
		await writeFile(join(installBase, "skills", "child", "SKILL.md"), "# child\n");

		await writeFile(
			join(dir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  parent:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/parent\n    version: 1.0.0\n    commit: abc\n    dependencies:\n      - child\n  child:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/child\n    version: 1.0.0\n    commit: abc\n    dependencies: []\n",
		);

		await removeCommand("parent", dir, { force: true });

		// Both parent and orphan child files should be gone
		await expect(stat(join(installBase, "skills", "parent"))).rejects.toThrow();
		await expect(stat(join(installBase, "skills", "child"))).rejects.toThrow();
	});
});
