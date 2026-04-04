import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand } from "../../src/commands/install.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-install-lf-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function writeManifest(dir: string, content: string): Promise<void> {
	await writeFile(join(dir, "skilltree.yaml"), content, "utf-8");
}

async function writeLockfile(dir: string, content: string): Promise<void> {
	await writeFile(join(dir, "skilltree.lock"), content, "utf-8");
}

describe("manifest validation in install", () => {
	test("rejects manifest with dep missing repo and local", async () => {
		const dir = await makeTempDir();
		await writeManifest(
			dir,
			"dependencies:\n  broken:\n    path: skills/broken\n    version: '^1.0.0'\n",
		);

		await expect(installCommand(dir, {})).rejects.toThrow("Manifest validation failed");
	});

	test("rejects manifest with same key in both groups", async () => {
		const dir = await makeTempDir();
		await writeManifest(
			dir,
			"dependencies:\n  dupe:\n    local: ./skills/dupe\ndev-dependencies:\n  dupe:\n    local: ./skills/dupe\n",
		);

		await expect(installCommand(dir, {})).rejects.toThrow("Manifest validation failed");
	});
});

describe("frozen mode", () => {
	test("errors without lockfile", async () => {
		const dir = await makeTempDir();
		await writeManifest(dir, "dependencies: {}\n");

		await expect(installCommand(dir, { frozen: true })).rejects.toThrow(
			"--frozen requires a lockfile",
		);
	});

	test("errors if manifest has entry not in lockfile", async () => {
		const dir = await makeTempDir();
		await writeManifest(
			dir,
			"dependencies:\n  new-skill:\n    repo: github.com/u/r\n    path: s\n    version: '*'\n",
		);
		await writeLockfile(dir, "lockfile_version: 1\npackages: {}\n");

		await expect(installCommand(dir, { frozen: true })).rejects.toThrow(
			"manifest has entries not in lockfile",
		);
	});

	test("errors if local dep adds new transitive dep not in lockfile", async () => {
		const dir = await makeTempDir();
		// Create local skill that declares a dependency
		await createLocalSkill(join(dir, "skills"), "my-local", ["brand-new-dep"]);
		await writeManifest(dir, "dependencies:\n  my-local:\n    local: ./skills/my-local\n");
		await writeLockfile(
			dir,
			"lockfile_version: 1\npackages:\n  my-local:\n    type: skill\n    group: prod\n    source: local\n    path: ./skills/my-local\n    commit: HEAD\n    dependencies: []\n",
		);

		await expect(installCommand(dir, { frozen: true })).rejects.toThrow("lockfile out of sync");
	});

	test("installs from lockfile with local deps", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-local");
		await writeManifest(dir, "dependencies:\n  my-local:\n    local: ./skills/my-local\n");
		await writeLockfile(
			dir,
			"lockfile_version: 1\npackages:\n  my-local:\n    type: skill\n    group: prod\n    source: local\n    path: ./skills/my-local\n    commit: HEAD\n    dependencies: []\n",
		);

		await installCommand(dir, { frozen: true });

		// Verify installed (symlinked)
		const { lstat } = await import("node:fs/promises");
		const stats = await lstat(join(dir, ".claude", "skills", "my-local"));
		expect(stats.isSymbolicLink()).toBe(true);
	});

	test("does not write lockfile in frozen mode", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-local");
		await writeManifest(dir, "dependencies:\n  my-local:\n    local: ./skills/my-local\n");
		const lockContent =
			"lockfile_version: 1\npackages:\n  my-local:\n    type: skill\n    group: prod\n    source: local\n    path: ./skills/my-local\n    commit: HEAD\n    dependencies: []\n";
		await writeLockfile(dir, lockContent);

		await installCommand(dir, { frozen: true });

		// Lockfile should be unchanged (no header added, no rewrite)
		const after = await readFile(join(dir, "skilltree.lock"), "utf-8");
		expect(after).toBe(lockContent);
	});
});

describe("integrity hash preservation", () => {
	test("reinstall preserves integrity hashes for skipped (already installed) entities", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeManifest(dir, "dependencies:\n  my-skill:\n    local: ./skills/my-skill\n");

		// First install — creates lockfile with integrity for copied entities
		await installCommand(dir, {});

		// Read the lockfile and manually add an integrity hash to simulate a remote dep
		// that was installed with integrity on first install
		const { readLockfile: readLf, writeLockfile: writeLf } = await import(
			"../../src/core/lockfile.js"
		);
		const lockfile = await readLf(dir);
		expect(lockfile).not.toBeNull();
		if (!lockfile) return;

		// Simulate what happens with remote deps: they get integrity hashes
		const entry = lockfile.packages["my-skill"];
		if (!entry) return;
		entry.integrity = "sha256-fakehash123";
		await writeLf(dir, lockfile);

		// Second install — lockfile is current, should install from lockfile
		// The entity is already installed, so it gets skipped
		// BUG: integrity hash was being dropped because the entity was skipped
		await installCommand(dir, {});

		// Verify integrity hash is preserved in the new lockfile
		const lockfileAfter = await readLf(dir);
		expect(lockfileAfter).not.toBeNull();
		expect(lockfileAfter?.packages["my-skill"]?.integrity).toBe("sha256-fakehash123");
	});
});

describe("lockfile-first install", () => {
	test("installs local dep without lockfile (full resolution)", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeManifest(dir, "dependencies:\n  my-skill:\n    local: ./skills/my-skill\n");

		await installCommand(dir, {});

		// Should have created lockfile
		const lockContent = await readFile(join(dir, "skilltree.lock"), "utf-8");
		expect(lockContent).toContain("my-skill");
	});

	test("failed resolution does not write lockfile", async () => {
		const dir = await makeTempDir();
		// Skill depends on nonexistent dep
		await createLocalSkill(join(dir, "skills"), "broken", ["nonexistent"]);
		await writeManifest(dir, "dependencies:\n  broken:\n    local: ./skills/broken\n");

		// Pre-create a lockfile to verify it's preserved
		await writeLockfile(dir, "lockfile_version: 1\npackages: {}\n");

		await expect(installCommand(dir, {})).rejects.toThrow("Resolution failed");

		// Original lockfile should be unchanged
		const after = await readFile(join(dir, "skilltree.lock"), "utf-8");
		expect(after).toBe("lockfile_version: 1\npackages: {}\n");
	});
});
