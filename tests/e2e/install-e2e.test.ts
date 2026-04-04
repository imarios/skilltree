import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import simpleGit from "simple-git";
import { installCommand } from "../../src/commands/install.js";
import { parseLockfile } from "../../src/core/lockfile.js";
import { createLocalSkill, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-e2e-install-"));
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

/**
 * Create a bare clone from a test repo (simulates what ensureCached does).
 */
async function makeBareClone(repoDir: string, baseDir: string, name: string): Promise<string> {
	const bareDir = join(baseDir, `${name}.git`);
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	return bareDir;
}

describe("e2e install: remote skill", () => {
	test("installs a remote skill from a tagged git repo", async () => {
		const dir = await makeTempDir();

		// Create a git repo with one skill
		const repoDir = await createTestRepo(
			dir,
			"skills-repo",
			[{ path: "skills/python-coding", name: "python-coding" }],
			"v1.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "skills-bare");

		await writeManifest(
			dir,
			`dependencies:\n  python-coding:\n    repo: "file://${bareDir}"\n    path: skills/python-coding\n    version: "^1.0.0"\n`,
		);

		await installCommand(dir, {});

		// Verify files installed
		const skillDir = join(dir, ".claude", "skills", "python-coding");
		const stat = await lstat(skillDir);
		expect(stat.isDirectory()).toBe(true);

		// Verify SKILL.md was copied
		const skillMd = await readFile(join(skillDir, "SKILL.md"), "utf-8");
		expect(skillMd).toContain("python-coding");

		// Verify lockfile
		const lockContent = await readFile(join(dir, "skilltree.lock"), "utf-8");
		const lockfile = parseLockfile(lockContent);
		expect(lockfile.packages["python-coding"]).toBeDefined();
		expect(lockfile.packages["python-coding"]?.version).toBe("1.0.0");
		expect(lockfile.packages["python-coding"]?.commit).toBeTruthy();
		expect(lockfile.packages["python-coding"]?.integrity).toBeTruthy();
		expect(lockfile.packages["python-coding"]?.type).toBe("skill");
		expect(lockfile.packages["python-coding"]?.group).toBe("prod");

		// Verify files are read-only (chmod 444)
		const skillMdStat = await lstat(join(skillDir, "SKILL.md"));
		const mode = skillMdStat.mode & 0o777;
		expect(mode).toBe(0o444);
	});
});

describe("e2e install: mixed local + remote", () => {
	test("local deps are symlinked, remote deps are copied", async () => {
		const dir = await makeTempDir();

		// Create local skill
		await createLocalSkill(join(dir, "skills"), "local-skill");

		// Create remote repo with skill
		const repoDir = await createTestRepo(
			dir,
			"remote-repo",
			[{ path: "skills/remote-skill", name: "remote-skill" }],
			"v2.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "remote-bare");

		await writeManifest(
			dir,
			`dependencies:\n  local-skill:\n    local: ./skills/local-skill\n  remote-skill:\n    repo: "file://${bareDir}"\n    path: skills/remote-skill\n    version: "^2.0.0"\n`,
		);

		await installCommand(dir, {});

		// Local skill should be symlinked
		const localStat = await lstat(join(dir, ".claude", "skills", "local-skill"));
		expect(localStat.isSymbolicLink()).toBe(true);
		const target = await readlink(join(dir, ".claude", "skills", "local-skill"));
		expect(target).toBe(resolve(dir, "skills/local-skill"));

		// Remote skill should be copied (not symlinked)
		const remoteStat = await lstat(join(dir, ".claude", "skills", "remote-skill"));
		expect(remoteStat.isDirectory()).toBe(true);
		expect(remoteStat.isSymbolicLink()).toBe(false);

		// Lockfile should have both
		const lockContent = await readFile(join(dir, "skilltree.lock"), "utf-8");
		const lockfile = parseLockfile(lockContent);
		expect(lockfile.packages["local-skill"]).toBeDefined();
		expect(lockfile.packages["local-skill"]?.source).toBe("local");
		expect(lockfile.packages["remote-skill"]).toBeDefined();
		expect(lockfile.packages["remote-skill"]?.version).toBe("2.0.0");
	});
});

describe("e2e install: cross-repo transitive deps", () => {
	test("resolves skill in repo A that depends on skill in repo B", async () => {
		const dir = await makeTempDir();

		// Repo B: has "base-skill" (no deps)
		const repoBDir = await createTestRepo(
			dir,
			"repo-b",
			[{ path: "skills/base-skill", name: "base-skill" }],
			"v1.0.0",
		);
		const bareBDir = await makeBareClone(repoBDir, dir, "repo-b-bare");

		// Repo A: has "top-skill" that depends on "base-skill"
		const repoADir = await createTestRepo(
			dir,
			"repo-a",
			[{ path: "skills/top-skill", name: "top-skill", dependencies: ["base-skill"] }],
			"v1.0.0",
		);
		const bareADir = await makeBareClone(repoADir, dir, "repo-a-bare");

		// Manifest declares both repos — base-skill needed for cross-repo resolution
		await writeManifest(
			dir,
			`dependencies:\n  top-skill:\n    repo: "file://${bareADir}"\n    path: skills/top-skill\n    version: "*"\n  base-skill:\n    repo: "file://${bareBDir}"\n    path: skills/base-skill\n    version: "*"\n`,
		);

		await installCommand(dir, {});

		// Both skills installed
		const topExists = await lstat(join(dir, ".claude", "skills", "top-skill"));
		expect(topExists.isDirectory()).toBe(true);
		const baseExists = await lstat(join(dir, ".claude", "skills", "base-skill"));
		expect(baseExists.isDirectory()).toBe(true);

		// Lockfile has both
		const lockContent = await readFile(join(dir, "skilltree.lock"), "utf-8");
		const lockfile = parseLockfile(lockContent);
		expect(lockfile.packages["top-skill"]?.dependencies).toContain("base-skill");
		expect(lockfile.packages["base-skill"]).toBeDefined();
	});
});

describe("e2e install: same-repo transitive auto-resolution", () => {
	test("child skill in same repo is auto-discovered without being in manifest", async () => {
		const dir = await makeTempDir();

		// Repo has both parent and child
		const repoDir = await createTestRepo(
			dir,
			"multi-skill-repo",
			[
				{ path: "skills/child-skill", name: "child-skill" },
				{ path: "skills/parent-skill", name: "parent-skill", dependencies: ["child-skill"] },
			],
			"v3.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "multi-bare");

		// Only declare parent in manifest
		await writeManifest(
			dir,
			`dependencies:\n  parent-skill:\n    repo: "file://${bareDir}"\n    path: skills/parent-skill\n    version: "^3.0.0"\n`,
		);

		await installCommand(dir, {});

		// Both installed
		expect((await lstat(join(dir, ".claude", "skills", "parent-skill"))).isDirectory()).toBe(true);
		expect((await lstat(join(dir, ".claude", "skills", "child-skill"))).isDirectory()).toBe(true);

		// Lockfile has both — child resolved as transitive
		const lockContent = await readFile(join(dir, "skilltree.lock"), "utf-8");
		const lockfile = parseLockfile(lockContent);
		expect(lockfile.packages["parent-skill"]?.dependencies).toContain("child-skill");
		expect(lockfile.packages["child-skill"]).toBeDefined();
		expect(lockfile.packages["child-skill"]?.version).toBe("3.0.0");
	});
});

describe("e2e install: --prod", () => {
	test("skips dev dependencies", async () => {
		const dir = await makeTempDir();

		await createLocalSkill(join(dir, "skills"), "prod-skill");
		await createLocalSkill(join(dir, "skills"), "dev-skill");

		await writeManifest(
			dir,
			"dependencies:\n  prod-skill:\n    local: ./skills/prod-skill\ndev-dependencies:\n  dev-skill:\n    local: ./skills/dev-skill\n",
		);

		await installCommand(dir, { prod: true });

		// Prod skill installed
		const prodStat = await lstat(join(dir, ".claude", "skills", "prod-skill"));
		expect(prodStat.isSymbolicLink()).toBe(true);

		// Dev skill NOT installed
		try {
			await lstat(join(dir, ".claude", "skills", "dev-skill"));
			expect(true).toBe(false); // Should not reach here
		} catch (e: unknown) {
			expect((e as NodeJS.ErrnoException).code).toBe("ENOENT");
		}
	});
});

describe("e2e install: --install-path", () => {
	test("copies local deps instead of symlinking to custom path", async () => {
		const dir = await makeTempDir();
		const buildDir = join(dir, "build", ".claude");

		await createLocalSkill(join(dir, "skills"), "my-skill");

		await writeManifest(dir, "dependencies:\n  my-skill:\n    local: ./skills/my-skill\n");

		await installCommand(dir, { installPath: buildDir });

		// Should be a copy, not a symlink
		const stat = await lstat(join(buildDir, "skills", "my-skill"));
		expect(stat.isDirectory()).toBe(true);
		expect(stat.isSymbolicLink()).toBe(false);

		// Content should be present
		const content = await readFile(join(buildDir, "skills", "my-skill", "SKILL.md"), "utf-8");
		expect(content).toContain("my-skill");
	});
});

describe("e2e install: --dry-run", () => {
	test("produces no side effects", async () => {
		const dir = await makeTempDir();

		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeManifest(dir, "dependencies:\n  my-skill:\n    local: ./skills/my-skill\n");

		await installCommand(dir, { dryRun: true });

		// No lockfile should exist
		try {
			await lstat(join(dir, "skilltree.lock"));
			expect(true).toBe(false); // Should not reach here
		} catch (e: unknown) {
			expect((e as NodeJS.ErrnoException).code).toBe("ENOENT");
		}

		// No .claude directory should exist
		try {
			await lstat(join(dir, ".claude"));
			expect(true).toBe(false);
		} catch (e: unknown) {
			expect((e as NodeJS.ErrnoException).code).toBe("ENOENT");
		}
	});
});

describe("e2e install: idempotent re-install", () => {
	test("installing twice produces the same result", async () => {
		const dir = await makeTempDir();

		const repoDir = await createTestRepo(
			dir,
			"repo",
			[{ path: "skills/stable-skill", name: "stable-skill" }],
			"v1.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "bare");

		await writeManifest(
			dir,
			`dependencies:\n  stable-skill:\n    repo: "file://${bareDir}"\n    path: skills/stable-skill\n    version: "*"\n`,
		);

		// First install
		await installCommand(dir, {});

		// Second install (--force to re-copy so lockfile is fully identical)
		await installCommand(dir, { force: true });
		const lock2 = await readFile(join(dir, "skilltree.lock"), "utf-8");

		// Third install — should be identical to second
		await installCommand(dir, { force: true });
		const lock3 = await readFile(join(dir, "skilltree.lock"), "utf-8");

		expect(lock2).toBe(lock3);

		// Skill still installed
		const stat = await lstat(join(dir, ".claude", "skills", "stable-skill"));
		expect(stat.isDirectory()).toBe(true);

		// Verify lockfile has all expected fields
		const lockfile = parseLockfile(lock3);
		expect(lockfile.packages["stable-skill"]?.integrity).toBeTruthy();
	});
});

describe("e2e install: lockfile-first optimization", () => {
	test("second install uses lockfile without re-resolution for remote-only deps", async () => {
		const dir = await makeTempDir();

		const repoDir = await createTestRepo(
			dir,
			"repo",
			[{ path: "skills/cached-skill", name: "cached-skill" }],
			"v1.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "bare");

		await writeManifest(
			dir,
			`dependencies:\n  cached-skill:\n    repo: "file://${bareDir}"\n    path: skills/cached-skill\n    version: "*"\n`,
		);

		// First install (full resolution)
		await installCommand(dir, {});

		// Capture console output for second install
		const originalLog = console.log;
		const logs: string[] = [];
		console.log = (...args: unknown[]) => logs.push(args.join(" "));

		try {
			await installCommand(dir, {});
		} finally {
			console.log = originalLog;
		}

		expect(logs.some((l) => l.includes("Lockfile is current"))).toBe(true);
	});
});
