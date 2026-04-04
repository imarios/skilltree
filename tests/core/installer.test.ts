import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import simpleGit from "simple-git";
import type { ResolvedEntity } from "../../src/core/graph.js";
import {
	computeIntegrity,
	executeInstall,
	getTargetPath,
	planInstall,
	verifyInstalled,
} from "../../src/core/installer.js";
import { createLocalSkill, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-install-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("getTargetPath", () => {
	test("returns skills/ path for skill entities", () => {
		const entity: ResolvedEntity = {
			key: "my-skill",
			name: "my-skill",
			type: "skill",
			group: "prod",
			path: "./skills/my-skill",
			commit: "HEAD",
			local: true,
			dependencies: [],
		};
		expect(getTargetPath(entity, "/project/.claude")).toBe("/project/.claude/skills/my-skill");
	});

	test("returns agents/ path for agent entities", () => {
		const entity: ResolvedEntity = {
			key: "my-agent",
			name: "my-agent",
			type: "agent",
			group: "prod",
			path: "./agents/my-agent.md",
			commit: "HEAD",
			local: true,
			dependencies: [],
		};
		expect(getTargetPath(entity, "/project/.claude")).toBe("/project/.claude/agents/my-agent.md");
	});
});

describe("computeIntegrity single file", () => {
	test("computes hash for a single file", async () => {
		const dir = await makeTempDir();
		const filePath = join(dir, "single.md");
		await writeFile(filePath, "# Single file\n");

		const hash = await computeIntegrity(filePath);
		expect(hash).toMatch(/^sha256-[a-f0-9]{64}$/);
	});
});

describe("computeIntegrity", () => {
	test("produces deterministic hash for a directory", async () => {
		const dir = await makeTempDir();
		const skillDir = join(dir, "test-skill");
		await mkdir(skillDir, { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), "# Test Skill\n");
		await writeFile(join(skillDir, "extra.md"), "Extra content\n");

		const hash1 = await computeIntegrity(skillDir);
		const hash2 = await computeIntegrity(skillDir);
		expect(hash1).toBe(hash2);
		expect(hash1).toMatch(/^sha256-[a-f0-9]{64}$/);
	});

	test("changes when content changes", async () => {
		const dir = await makeTempDir();
		const skillDir = join(dir, "test-skill");
		await mkdir(skillDir, { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), "# Version 1\n");

		const hash1 = await computeIntegrity(skillDir);

		await writeFile(join(skillDir, "SKILL.md"), "# Version 2\n");

		const hash2 = await computeIntegrity(skillDir);
		expect(hash1).not.toBe(hash2);
	});
});

describe("planInstall", () => {
	test("skips dev deps in prod mode", async () => {
		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:prod-skill",
				{
					key: "prod-skill",
					name: "prod-skill",
					type: "skill",
					group: "prod",
					path: "./skills/prod",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
			[
				"skill:dev-skill",
				{
					key: "dev-skill",
					name: "dev-skill",
					type: "skill",
					group: "dev",
					path: "./skills/dev",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const plan = await planInstall(
			entities,
			["skill:prod-skill", "skill:dev-skill"],
			"/project/.claude",
			{ prod: true },
		);
		expect(plan.toInstall.length).toBe(1);
		expect(plan.toInstall[0]?.entity.name).toBe("prod-skill");
		expect(plan.skipped.length).toBe(1);
	});

	test("uses symlink for local deps by default", async () => {
		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:local-skill",
				{
					key: "local-skill",
					name: "local-skill",
					type: "skill",
					group: "prod",
					path: "./skills/local",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const plan = await planInstall(entities, ["skill:local-skill"], "/project/.claude", {});
		expect(plan.toInstall[0]?.action).toBe("symlink");
	});

	test("uses copy for local deps with --install-path", async () => {
		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:local-skill",
				{
					key: "local-skill",
					name: "local-skill",
					type: "skill",
					group: "prod",
					path: "./skills/local",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const plan = await planInstall(entities, ["skill:local-skill"], "/build/.claude", {
			installPath: "/build/.claude",
		});
		expect(plan.toInstall[0]?.action).toBe("copy");
	});
});

describe("executeInstall with local deps", () => {
	test("symlinks local skill", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		const installBase = join(dir, ".claude");

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:my-skill",
				{
					key: "my-skill",
					name: "my-skill",
					type: "skill",
					group: "prod",
					path: "./skills/my-skill",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const plan = await planInstall(entities, ["skill:my-skill"], installBase, {});
		await executeInstall(plan, dir, {});

		const targetPath = join(installBase, "skills", "my-skill");
		const stats = await lstat(targetPath);
		expect(stats.isSymbolicLink()).toBe(true);

		const linkTarget = await readlink(targetPath);
		expect(linkTarget).toBe(resolve(dir, "./skills/my-skill"));
	});

	test("copies local skill with --install-path", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		const installBase = join(dir, "build", ".claude");

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:my-skill",
				{
					key: "my-skill",
					name: "my-skill",
					type: "skill",
					group: "prod",
					path: "./skills/my-skill",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const plan = await planInstall(entities, ["skill:my-skill"], installBase, {
			installPath: installBase,
		});
		const integrityMap = await executeInstall(plan, dir, { installPath: installBase });

		const targetPath = join(installBase, "skills", "my-skill");
		const stats = await lstat(targetPath);
		expect(stats.isDirectory()).toBe(true);

		// Should have integrity hash
		expect(integrityMap.size).toBe(1);

		// Copied file should have read-only permissions
		const skillMd = join(targetPath, "SKILL.md");
		const fileStats = await lstat(skillMd);
		expect(fileStats.mode & 0o777).toBe(0o444);
	});
});

describe("verifyInstalled", () => {
	test("reports linked status for symlinked deps", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		const installBase = join(dir, ".claude");

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:my-skill",
				{
					key: "my-skill",
					name: "my-skill",
					type: "skill",
					group: "prod",
					path: "./skills/my-skill",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const plan = await planInstall(entities, ["skill:my-skill"], installBase, {});
		await executeInstall(plan, dir, {});

		const statuses = await verifyInstalled(entities, installBase, {});
		expect(statuses[0]?.status).toBe("linked");
	});

	test("reports missing status for non-existent deps", async () => {
		const dir = await makeTempDir();
		const installBase = join(dir, ".claude");

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:missing",
				{
					key: "missing",
					name: "missing",
					type: "skill",
					group: "prod",
					path: "./skills/missing",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const statuses = await verifyInstalled(entities, installBase, {});
		expect(statuses[0]?.status).toBe("missing");
	});

	test("reports ok for matching integrity", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		const installBase = join(dir, ".claude");

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:my-skill",
				{
					key: "my-skill",
					name: "my-skill",
					type: "skill",
					group: "prod",
					path: "./skills/my-skill",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		// Install as copy (not symlink) to get integrity
		const plan = await planInstall(entities, ["skill:my-skill"], installBase, {
			installPath: installBase,
		});
		const integrityMap = await executeInstall(plan, dir, { installPath: installBase });

		// Build integrity record from map
		const lockfileIntegrity: Record<string, string> = {};
		for (const [key, hash] of integrityMap) {
			lockfileIntegrity[key] = hash;
		}

		const statuses = await verifyInstalled(entities, installBase, lockfileIntegrity);
		expect(statuses[0]?.status).toBe("ok");
	});

	test("reports modified for changed content", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		const installBase = join(dir, ".claude");

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:my-skill",
				{
					key: "my-skill",
					name: "my-skill",
					type: "skill",
					group: "prod",
					path: "./skills/my-skill",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const plan = await planInstall(entities, ["skill:my-skill"], installBase, {
			installPath: installBase,
		});
		const integrityMap = await executeInstall(plan, dir, { installPath: installBase });

		const lockfileIntegrity: Record<string, string> = {};
		for (const [key, hash] of integrityMap) {
			lockfileIntegrity[key] = hash;
		}

		// Modify installed file (need to make writable first)
		const skillMd = join(installBase, "skills", "my-skill", "SKILL.md");
		const { chmod } = await import("node:fs/promises");
		await chmod(skillMd, 0o644);
		await writeFile(skillMd, "# Modified!\n");

		const statuses = await verifyInstalled(entities, installBase, lockfileIntegrity);
		expect(statuses[0]?.status).toBe("modified");
	});
});

describe("executeInstall with --force", () => {
	test("force overwrites existing non-symlink directory", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		const installBase = join(dir, ".claude");

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:my-skill",
				{
					key: "my-skill",
					name: "my-skill",
					type: "skill",
					group: "prod",
					path: "./skills/my-skill",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		// First install (copy)
		const plan1 = await planInstall(entities, ["skill:my-skill"], installBase, {
			installPath: installBase,
		});
		await executeInstall(plan1, dir, { installPath: installBase });

		// Second install with --force should succeed
		const plan2 = await planInstall(entities, ["skill:my-skill"], installBase, {
			installPath: installBase,
		});
		const integrityMap = await executeInstall(plan2, dir, {
			installPath: installBase,
			force: true,
		});
		expect(integrityMap.size).toBe(1);
	});
});

describe("executeInstall from git cache", () => {
	test("copies skill directory from bare repo", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"remote-repo",
			[{ path: "skills/remote-skill", name: "remote-skill" }],
			"v1.0.0",
		);

		// Create bare clone
		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const installBase = join(dir, ".claude");
		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:remote-skill",
				{
					key: "remote-skill",
					name: "remote-skill",
					type: "skill",
					group: "prod",
					repo: "github.com/test/repo",
					path: "skills/remote-skill",
					version: "1.0.0",
					tag: "v1.0.0",
					commit: "abc",
					local: false,
					dependencies: [],
					cachePath: bareDir,
				},
			],
		]);

		const plan = await planInstall(entities, ["skill:remote-skill"], installBase, {});
		const integrityMap = await executeInstall(plan, dir, {});

		const targetPath = join(installBase, "skills", "remote-skill");
		const stats = await lstat(targetPath);
		expect(stats.isDirectory()).toBe(true);

		const content = await readFile(join(targetPath, "SKILL.md"), "utf-8");
		expect(content).toContain("name: remote-skill");
		expect(integrityMap.size).toBe(1);
	});
});
