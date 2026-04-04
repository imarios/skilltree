import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { installCommand } from "../../src/commands/install.js";
import { removeCommand } from "../../src/commands/remove.js";
import { parseLockfile } from "../../src/core/lockfile.js";
import { createLocalSkill, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-e2e-edge-"));
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

async function makeBareClone(repoDir: string, baseDir: string, name: string): Promise<string> {
	const bareDir = join(baseDir, `${name}.git`);
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	return bareDir;
}

describe("e2e edge: diamond dependency through remote repos", () => {
	test("A→B, A→C, B→D, C→D — D installed once, correct order", async () => {
		const dir = await makeTempDir();

		// Single repo with diamond: A depends on B and C; B and C both depend on D
		const repoDir = await createTestRepo(
			dir,
			"diamond-repo",
			[
				{ path: "skills/skill-d", name: "skill-d" },
				{ path: "skills/skill-b", name: "skill-b", dependencies: ["skill-d"] },
				{ path: "skills/skill-c", name: "skill-c", dependencies: ["skill-d"] },
				{ path: "skills/skill-a", name: "skill-a", dependencies: ["skill-b", "skill-c"] },
			],
			"v1.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "diamond-bare");

		await writeManifest(
			dir,
			`dependencies:\n  skill-a:\n    repo: "file://${bareDir}"\n    path: skills/skill-a\n    version: "*"\n`,
		);

		await installCommand(dir, {});

		// All 4 should be installed
		for (const name of ["skill-a", "skill-b", "skill-c", "skill-d"]) {
			const stat = await lstat(join(dir, ".claude", "skills", name));
			expect(stat.isDirectory()).toBe(true);
		}

		// Lockfile should have all 4
		const lockfile = parseLockfile(await readFile(join(dir, "skilltree.lock"), "utf-8"));
		expect(Object.keys(lockfile.packages)).toHaveLength(4);
		expect(lockfile.packages["skill-a"]?.dependencies).toContain("skill-b");
		expect(lockfile.packages["skill-a"]?.dependencies).toContain("skill-c");
		expect(lockfile.packages["skill-b"]?.dependencies).toContain("skill-d");
		expect(lockfile.packages["skill-c"]?.dependencies).toContain("skill-d");
	});
});

describe("e2e edge: mixed skill + agent graph", () => {
	test("agent depends on two skills — all installed to correct paths", async () => {
		const dir = await makeTempDir();

		// Create local skills and agent
		await createLocalSkill(join(dir, "skills"), "coding-skill");
		await createLocalSkill(join(dir, "skills"), "testing-skill");

		// Create local agent that depends on both skills
		await mkdir(join(dir, "agents", "source"), { recursive: true });
		await writeFile(
			join(dir, "agents", "source", "dev-agent.md"),
			"---\nname: dev-agent\ndependencies:\n  - coding-skill\n  - testing-skill\n---\n\n# Dev Agent\n",
		);

		await writeManifest(
			dir,
			"dependencies:\n  coding-skill:\n    local: ./skills/coding-skill\n  testing-skill:\n    local: ./skills/testing-skill\n  dev-agent:\n    local: ./agents/source/dev-agent.md\n    type: agent\n",
		);

		await installCommand(dir, {});

		// Skills installed to skills/
		const codingStat = await lstat(join(dir, ".claude", "skills", "coding-skill"));
		expect(codingStat.isSymbolicLink()).toBe(true);

		const testingStat = await lstat(join(dir, ".claude", "skills", "testing-skill"));
		expect(testingStat.isSymbolicLink()).toBe(true);

		// Agent installed to agents/ as .md file
		const agentStat = await lstat(join(dir, ".claude", "agents", "dev-agent.md"));
		expect(agentStat.isSymbolicLink()).toBe(true);

		// Lockfile has correct types
		const lockfile = parseLockfile(await readFile(join(dir, "skilltree.lock"), "utf-8"));
		expect(lockfile.packages["coding-skill"]?.type).toBe("skill");
		expect(lockfile.packages["testing-skill"]?.type).toBe("skill");
		expect(lockfile.packages["dev-agent"]?.type).toBe("agent");
		expect(lockfile.packages["dev-agent"]?.dependencies).toContain("coding-skill");
		expect(lockfile.packages["dev-agent"]?.dependencies).toContain("testing-skill");
	});
});

describe("e2e edge: agent with transitive skill chain", () => {
	test("agent -> skill1 -> skill2 installs all three correctly", async () => {
		const dir = await makeTempDir();

		// Create skill2 (leaf, no deps)
		await createLocalSkill(join(dir, "skills"), "base-skill");

		// Create skill1 that depends on skill2
		await createLocalSkill(join(dir, "skills"), "mid-skill", ["base-skill"]);

		// Create agent that depends on skill1
		await mkdir(join(dir, "agents", "source"), { recursive: true });
		await writeFile(
			join(dir, "agents", "source", "top-agent.md"),
			"---\nname: top-agent\ndependencies:\n  - mid-skill\n---\n\n# Top Agent\n",
		);

		// Only agent and mid-skill in manifest — base-skill is transitive
		await writeManifest(
			dir,
			"dependencies:\n  mid-skill:\n    local: ./skills/mid-skill\n  base-skill:\n    local: ./skills/base-skill\n  top-agent:\n    local: ./agents/source/top-agent.md\n    type: agent\n",
		);

		await installCommand(dir, {});

		// All three installed to correct paths
		const baseStat = await lstat(join(dir, ".claude", "skills", "base-skill"));
		expect(baseStat.isSymbolicLink()).toBe(true);

		const midStat = await lstat(join(dir, ".claude", "skills", "mid-skill"));
		expect(midStat.isSymbolicLink()).toBe(true);

		const agentStat = await lstat(join(dir, ".claude", "agents", "top-agent.md"));
		expect(agentStat.isSymbolicLink()).toBe(true);

		// Lockfile captures the full dependency chain
		const lockfile = parseLockfile(await readFile(join(dir, "skilltree.lock"), "utf-8"));
		expect(lockfile.packages["top-agent"]?.type).toBe("agent");
		expect(lockfile.packages["mid-skill"]?.type).toBe("skill");
		expect(lockfile.packages["base-skill"]?.type).toBe("skill");
		expect(lockfile.packages["top-agent"]?.dependencies).toContain("mid-skill");
		expect(lockfile.packages["mid-skill"]?.dependencies).toContain("base-skill");
	});
});

describe("e2e edge: version conflict", () => {
	test("incompatible constraints on same repo produce clear error", async () => {
		const dir = await makeTempDir();

		// Create repo with two skills
		const repoDir = await createTestRepo(
			dir,
			"conflict-repo",
			[
				{ path: "skills/skill-x", name: "skill-x" },
				{ path: "skills/skill-y", name: "skill-y" },
			],
			"v1.0.0",
		);
		// Add v2.0.0
		const git = simpleGit(repoDir);
		await writeFile(
			join(repoDir, "skills", "skill-x", "SKILL.md"),
			"---\nname: skill-x\n---\n\n# skill-x v2\n",
		);
		await git.add(".");
		await git.commit("v2 update");
		await git.addTag("v2.0.0");

		const bareDir = await makeBareClone(repoDir, dir, "conflict-bare");

		// Declare conflicting constraints: one wants ^1.0.0, other wants ^2.0.0
		await writeManifest(
			dir,
			`dependencies:\n  skill-x:\n    repo: "file://${bareDir}"\n    path: skills/skill-x\n    version: "^1.0.0"\n  skill-y:\n    repo: "file://${bareDir}"\n    path: skills/skill-y\n    version: "^2.0.0"\n`,
		);

		await expect(installCommand(dir, {})).rejects.toThrow("Resolution failed");
	});
});

describe("e2e edge: --prod --frozen --install-path combined (CI simulation)", () => {
	test("installs only prod deps from lockfile to custom path", async () => {
		const dir = await makeTempDir();
		const buildDir = join(dir, "build", ".claude");

		// Create local prod and dev skills
		await createLocalSkill(join(dir, "skills"), "prod-skill");
		await createLocalSkill(join(dir, "skills"), "dev-skill");

		await writeManifest(
			dir,
			"dependencies:\n  prod-skill:\n    local: ./skills/prod-skill\ndev-dependencies:\n  dev-skill:\n    local: ./skills/dev-skill\n",
		);

		// First: regular install to create lockfile
		await installCommand(dir, {});

		// Now: CI-style install
		await installCommand(dir, {
			prod: true,
			frozen: true,
			installPath: buildDir,
		});

		// Prod skill should be copied (not symlinked)
		const prodStat = await lstat(join(buildDir, "skills", "prod-skill"));
		expect(prodStat.isDirectory()).toBe(true);
		expect(prodStat.isSymbolicLink()).toBe(false);

		// Dev skill should NOT exist in build dir
		try {
			await lstat(join(buildDir, "skills", "dev-skill"));
			expect(true).toBe(false); // Should not exist
		} catch (e: unknown) {
			expect((e as NodeJS.ErrnoException).code).toBe("ENOENT");
		}

		// Content should be present
		const content = await readFile(join(buildDir, "skills", "prod-skill", "SKILL.md"), "utf-8");
		expect(content).toContain("prod-skill");
	});
});

describe("e2e edge: remove with orphan cascade", () => {
	test("removing A also removes orphaned B and C (A→B→C)", async () => {
		const dir = await makeTempDir();

		// A depends on B, B depends on C
		await createLocalSkill(join(dir, "skills"), "skill-c");
		await createLocalSkill(join(dir, "skills"), "skill-b", ["skill-c"]);
		await createLocalSkill(join(dir, "skills"), "skill-a", ["skill-b"]);

		await writeManifest(
			dir,
			"dependencies:\n  skill-a:\n    local: ./skills/skill-a\n  skill-b:\n    local: ./skills/skill-b\n  skill-c:\n    local: ./skills/skill-c\n",
		);

		await installCommand(dir, {});

		// All three installed
		for (const name of ["skill-a", "skill-b", "skill-c"]) {
			const stat = await lstat(join(dir, ".claude", "skills", name));
			expect(stat.isSymbolicLink()).toBe(true);
		}

		// Remove A — B and C should become orphans (if only A references them)
		await removeCommand("skill-a", dir, { force: true });

		const lockfile = parseLockfile(await readFile(join(dir, "skilltree.lock"), "utf-8"));
		expect(lockfile.packages["skill-a"]).toBeUndefined();

		// B and C are still in manifest (they were declared directly), so they should NOT be orphaned
		expect(lockfile.packages["skill-b"]).toBeDefined();
		expect(lockfile.packages["skill-c"]).toBeDefined();
	});

	test("transitive-only deps are orphaned when parent is removed", async () => {
		const dir = await makeTempDir();

		// Create repo where parent depends on child (transitive, not in manifest)
		const repoDir = await createTestRepo(
			dir,
			"repo",
			[
				{ path: "skills/child", name: "child" },
				{ path: "skills/parent", name: "parent", dependencies: ["child"] },
			],
			"v1.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "bare");

		// Only parent in manifest — child is transitive
		await writeManifest(
			dir,
			`dependencies:\n  parent:\n    repo: "file://${bareDir}"\n    path: skills/parent\n    version: "*"\n`,
		);

		await installCommand(dir, {});

		// Both installed
		const lockBefore = parseLockfile(await readFile(join(dir, "skilltree.lock"), "utf-8"));
		expect(lockBefore.packages.parent).toBeDefined();
		expect(lockBefore.packages.child).toBeDefined();

		// Remove parent — child should be orphaned
		await removeCommand("parent", dir, { force: true });

		const lockAfter = parseLockfile(await readFile(join(dir, "skilltree.lock"), "utf-8"));
		expect(lockAfter.packages.parent).toBeUndefined();
		expect(lockAfter.packages.child).toBeUndefined(); // orphaned
	});
});

describe("e2e edge: tagless repo fallback", () => {
	test("repo with no tags falls back to default branch with warning", async () => {
		const dir = await makeTempDir();

		// Create repo WITHOUT tagging
		const repoDir = await createTestRepo(
			dir,
			"tagless-repo",
			[{ path: "skills/tagless-skill", name: "tagless-skill" }],
			// No tag version!
		);
		const bareDir = await makeBareClone(repoDir, dir, "tagless-bare");

		await writeManifest(
			dir,
			`dependencies:\n  tagless-skill:\n    repo: "file://${bareDir}"\n    path: skills/tagless-skill\n    version: "*"\n`,
		);

		// Capture warnings
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

		try {
			await installCommand(dir, {});
		} finally {
			console.warn = originalWarn;
		}

		// Should have installed
		const stat = await lstat(join(dir, ".claude", "skills", "tagless-skill"));
		expect(stat.isDirectory()).toBe(true);

		// Should have produced a warning about no tags
		expect(warnings.some((w) => w.includes("no version tags"))).toBe(true);

		// Lockfile should have commit but no version
		const lockfile = parseLockfile(await readFile(join(dir, "skilltree.lock"), "utf-8"));
		expect(lockfile.packages["tagless-skill"]).toBeDefined();
		expect(lockfile.packages["tagless-skill"]?.commit).toBeTruthy();
		expect(lockfile.packages["tagless-skill"]?.version).toBeUndefined();
	});
});

describe("e2e edge: re-install after remove", () => {
	test("remove then re-add and install works correctly", async () => {
		const dir = await makeTempDir();

		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeManifest(dir, "dependencies:\n  my-skill:\n    local: ./skills/my-skill\n");

		// Install
		await installCommand(dir, {});
		const stat1 = await lstat(join(dir, ".claude", "skills", "my-skill"));
		expect(stat1.isSymbolicLink()).toBe(true);

		// Remove
		await removeCommand("my-skill", dir, { force: true });

		// Verify removed
		try {
			await lstat(join(dir, ".claude", "skills", "my-skill"));
			expect(true).toBe(false);
		} catch (e: unknown) {
			expect((e as NodeJS.ErrnoException).code).toBe("ENOENT");
		}

		// Re-add and re-install
		await writeManifest(dir, "dependencies:\n  my-skill:\n    local: ./skills/my-skill\n");
		await installCommand(dir, {});

		// Should be back
		const stat2 = await lstat(join(dir, ".claude", "skills", "my-skill"));
		expect(stat2.isSymbolicLink()).toBe(true);
	});
});

describe("e2e edge: deep transitive chain across repos", () => {
	test("A→B→C→D across 2 repos, all resolved and installed", async () => {
		const dir = await makeTempDir();

		// Repo 1: has D (leaf) and C (depends on D)
		const repo1Dir = await createTestRepo(
			dir,
			"repo-1",
			[
				{ path: "skills/skill-d", name: "skill-d" },
				{ path: "skills/skill-c", name: "skill-c", dependencies: ["skill-d"] },
			],
			"v1.0.0",
		);
		const bare1Dir = await makeBareClone(repo1Dir, dir, "repo-1-bare");

		// Repo 2: has B (depends on C) and A (depends on B)
		const repo2Dir = await createTestRepo(
			dir,
			"repo-2",
			[
				{ path: "skills/skill-b", name: "skill-b", dependencies: ["skill-c"] },
				{ path: "skills/skill-a", name: "skill-a", dependencies: ["skill-b"] },
			],
			"v1.0.0",
		);
		const bare2Dir = await makeBareClone(repo2Dir, dir, "repo-2-bare");

		// Manifest: A from repo-2, C from repo-1
		// B is transitive from repo-2, D is transitive from repo-1
		await writeManifest(
			dir,
			`dependencies:\n  skill-a:\n    repo: "file://${bare2Dir}"\n    path: skills/skill-a\n    version: "*"\n  skill-c:\n    repo: "file://${bare1Dir}"\n    path: skills/skill-c\n    version: "*"\n`,
		);

		await installCommand(dir, {});

		// All 4 installed
		for (const name of ["skill-a", "skill-b", "skill-c", "skill-d"]) {
			const stat = await lstat(join(dir, ".claude", "skills", name));
			expect(stat.isDirectory()).toBe(true);
		}

		const lockfile = parseLockfile(await readFile(join(dir, "skilltree.lock"), "utf-8"));
		expect(Object.keys(lockfile.packages)).toHaveLength(4);
		expect(lockfile.packages["skill-a"]?.dependencies).toContain("skill-b");
		expect(lockfile.packages["skill-b"]?.dependencies).toContain("skill-c");
		expect(lockfile.packages["skill-c"]?.dependencies).toContain("skill-d");
	});
});

describe("e2e edge: empty manifest", () => {
	test("install with zero dependencies creates valid empty lockfile", async () => {
		const dir = await makeTempDir();

		await writeManifest(dir, "dependencies: {}\n");

		await installCommand(dir, {});

		const lockfile = parseLockfile(await readFile(join(dir, "skilltree.lock"), "utf-8"));
		expect(lockfile.lockfile_version).toBe(1);
		expect(Object.keys(lockfile.packages)).toHaveLength(0);
	});
});
