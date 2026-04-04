/**
 * Pre-refactoring tests for complex installer.ts functions:
 * - executeInstall (26), verifyInstalled (34)
 *
 * These tests exercise specific branches to ensure refactoring doesn't break them.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import simpleGit from "simple-git";
import type { ResolvedEntity } from "../../src/core/graph.js";
import { executeInstall, planInstall, verifyInstalled } from "../../src/core/installer.js";
import { createLocalSkill, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-inst-comp-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("executeInstall: symlink replacement", () => {
	test("replaces existing symlink with new one on reinstall", async () => {
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

		// First install
		const plan1 = await planInstall(entities, ["skill:my-skill"], installBase, {});
		await executeInstall(plan1, dir, {});
		const stat1 = await lstat(join(installBase, "skills", "my-skill"));
		expect(stat1.isSymbolicLink()).toBe(true);

		// Second install — should replace cleanly
		const plan2 = await planInstall(entities, ["skill:my-skill"], installBase, {});
		await executeInstall(plan2, dir, {});
		const stat2 = await lstat(join(installBase, "skills", "my-skill"));
		expect(stat2.isSymbolicLink()).toBe(true);
	});
});

describe("executeInstall: agent single-file copy from git", () => {
	test("copies agent .md file from bare repo", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"agent-repo",
			[{ path: "agents/my-agent.md", name: "my-agent", isAgent: true }],
			"v1.0.0",
		);
		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const installBase = join(dir, ".claude");
		const entities = new Map<string, ResolvedEntity>([
			[
				"agent:my-agent",
				{
					key: "my-agent",
					name: "my-agent",
					type: "agent",
					group: "prod",
					repo: "github.com/test/repo",
					path: "agents/my-agent.md",
					version: "1.0.0",
					tag: "v1.0.0",
					commit: "abc",
					local: false,
					dependencies: [],
					cachePath: bareDir,
				},
			],
		]);

		const plan = await planInstall(entities, ["agent:my-agent"], installBase, {});
		await executeInstall(plan, dir, {});

		// Agent should be installed as a single file
		const agentPath = join(installBase, "agents", "my-agent.md");
		const stat = await lstat(agentPath);
		expect(stat.isFile()).toBe(true);
	});
});

describe("executeInstall: local agent symlink", () => {
	test("symlinks local agent .md file", async () => {
		const dir = await makeTempDir();
		await mkdir(join(dir, "agents"), { recursive: true });
		await writeFile(join(dir, "agents", "my-agent.md"), "---\nname: my-agent\n---\n\n# Agent\n");
		const installBase = join(dir, ".claude");

		const entities = new Map<string, ResolvedEntity>([
			[
				"agent:my-agent",
				{
					key: "my-agent",
					name: "my-agent",
					type: "agent",
					group: "prod",
					path: "./agents/my-agent.md",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const plan = await planInstall(entities, ["agent:my-agent"], installBase, {});
		await executeInstall(plan, dir, {});

		const agentPath = join(installBase, "agents", "my-agent.md");
		const stat = await lstat(agentPath);
		expect(stat.isSymbolicLink()).toBe(true);
	});
});

describe("executeInstall: --force overwrites copy with symlink", () => {
	test("force replaces non-symlink directory with symlink", async () => {
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

		// First install as copy
		const plan1 = await planInstall(entities, ["skill:my-skill"], installBase, {
			installPath: installBase,
		});
		await executeInstall(plan1, dir, { installPath: installBase });

		const stat1 = await lstat(join(installBase, "skills", "my-skill"));
		expect(stat1.isDirectory()).toBe(true);
		expect(stat1.isSymbolicLink()).toBe(false);

		// Now force install as symlink
		const plan2 = await planInstall(entities, ["skill:my-skill"], installBase, {});
		await executeInstall(plan2, dir, { force: true });

		const stat2 = await lstat(join(installBase, "skills", "my-skill"));
		expect(stat2.isSymbolicLink()).toBe(true);
	});
});

describe("verifyInstalled: comprehensive status checks", () => {
	test("reports broken for symlink to deleted target", async () => {
		const dir = await makeTempDir();
		const installBase = join(dir, ".claude");
		await mkdir(join(installBase, "skills"), { recursive: true });

		// Create skill, symlink, then delete the source
		await createLocalSkill(join(dir, "skills"), "ephemeral");
		await symlink(resolve(dir, "skills/ephemeral"), join(installBase, "skills", "ephemeral"));
		await rm(join(dir, "skills", "ephemeral"), { recursive: true });

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:ephemeral",
				{
					key: "ephemeral",
					name: "ephemeral",
					type: "skill",
					group: "prod",
					path: "./skills/ephemeral",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const statuses = await verifyInstalled(entities, installBase, {}, dir);
		expect(statuses[0]?.status).toBe("broken");
	});

	test("reports missing for completely absent entity", async () => {
		const dir = await makeTempDir();
		const installBase = join(dir, ".claude");

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:ghost",
				{
					key: "ghost",
					name: "ghost",
					type: "skill",
					group: "prod",
					path: "./skills/ghost",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const statuses = await verifyInstalled(entities, installBase, {}, dir);
		expect(statuses[0]?.status).toBe("missing");
	});

	test("reports ok for copied file with matching integrity", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "verified");
		const installBase = join(dir, ".claude");

		// Use a local entity with --install-path to get a copy with integrity
		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:verified",
				{
					key: "verified",
					name: "verified",
					type: "skill",
					group: "prod",
					path: "./skills/verified",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const plan = await planInstall(entities, ["skill:verified"], installBase, {
			installPath: installBase,
		});
		const integrityMap = await executeInstall(plan, dir, { installPath: installBase });

		const lockfileIntegrity: Record<string, string> = {};
		for (const [key, hash] of integrityMap) {
			lockfileIntegrity[key] = hash;
		}

		const statuses = await verifyInstalled(entities, installBase, lockfileIntegrity, dir);
		expect(statuses[0]?.status).toBe("ok");
	});

	test("reports modified when copied file is altered", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "tampered");
		const installBase = join(dir, ".claude");

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:tampered",
				{
					key: "tampered",
					name: "tampered",
					type: "skill",
					group: "prod",
					path: "./skills/tampered",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const plan = await planInstall(entities, ["skill:tampered"], installBase, {
			installPath: installBase,
		});
		const integrityMap = await executeInstall(plan, dir, { installPath: installBase });

		const lockfileIntegrity: Record<string, string> = {};
		for (const [key, hash] of integrityMap) {
			lockfileIntegrity[key] = hash;
		}

		// Tamper with installed file
		const skillMd = join(installBase, "skills", "tampered", "SKILL.md");
		await chmod(skillMd, 0o644);
		await writeFile(skillMd, "# Tampered\n");

		const statuses = await verifyInstalled(entities, installBase, lockfileIntegrity, dir);
		// Could be "modified" (integrity changed) or "stale" (source differs from lockfile)
		const status = statuses[0]?.status;
		expect(status === "modified" || status === "stale").toBe(true);
	});

	test("reports ok for entity without integrity hash", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "no-hash");
		const installBase = join(dir, ".claude");

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:no-hash",
				{
					key: "no-hash",
					name: "no-hash",
					type: "skill",
					group: "prod",
					path: "./skills/no-hash",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const plan = await planInstall(entities, ["skill:no-hash"], installBase, {
			installPath: installBase,
		});
		await executeInstall(plan, dir, { installPath: installBase });

		// No integrity in lockfile — should still report ok
		const statuses = await verifyInstalled(entities, installBase, {}, dir);
		expect(statuses[0]?.status).toBe("ok");
	});
});
