import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { ResolvedEntity } from "../../src/core/graph.js";
import { resolveAll } from "../../src/core/graph.js";
import { executeInstall, planInstall } from "../../src/core/installer.js";
import type { Manifest } from "../../src/types.js";
import { createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-missing-remote-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("resolver: remote dep path does not exist at ref", () => {
	test("reports error when skill path is missing from repo at resolved tag", async () => {
		const dir = await makeTempDir();

		// Create a repo with a skill, tag it v1.0.0
		const repoDir = await createTestRepo(
			dir,
			"remote",
			[{ path: "skills/my-skill", name: "my-skill" }],
			"v1.0.0",
		);

		// Now remove the skill and create a new tag v2.0.0
		const git = simpleGit(repoDir);
		await rm(join(repoDir, "skills", "my-skill"), { recursive: true });
		await git.add(".");
		await git.commit("Remove my-skill");
		await git.addTag("v2.0.0");

		// Create bare clone
		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		// Reference the removed skill path at v2.0.0
		const manifest: Manifest = {
			dependencies: {
				"my-skill": {
					repo: `file://${bareDir}`,
					path: "skills/my-skill",
					version: "^2.0.0",
				},
			},
		};

		const result = await resolveAll(manifest, dir);
		// Should report an error, NOT silently resolve
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors.some((e) => /not found|does not exist|missing/i.test(e))).toBe(true);
		expect(result.errors.some((e) => e.includes("my-skill"))).toBe(true);
	});

	test("reports error when agent path is missing from repo at resolved tag", async () => {
		const dir = await makeTempDir();

		const repoDir = await createTestRepo(
			dir,
			"remote",
			[{ path: "agents/my-agent.md", name: "my-agent", isAgent: true }],
			"v1.0.0",
		);

		// Remove the agent and tag v2.0.0
		const git = simpleGit(repoDir);
		await rm(join(repoDir, "agents", "my-agent.md"));
		await git.add(".");
		await git.commit("Remove my-agent");
		await git.addTag("v2.0.0");

		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const manifest: Manifest = {
			dependencies: {
				"my-agent": {
					repo: `file://${bareDir}`,
					path: "agents/my-agent.md",
					version: "^2.0.0",
					type: "agent",
				},
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors.some((e) => /not found|does not exist|missing/i.test(e))).toBe(true);
		expect(result.errors.some((e) => e.includes("my-agent"))).toBe(true);
	});

	test("batch-reports multiple missing remote paths", async () => {
		const dir = await makeTempDir();

		// Create repo with two skills
		const repoDir = await createTestRepo(
			dir,
			"remote",
			[
				{ path: "skills/skill-a", name: "skill-a" },
				{ path: "skills/skill-b", name: "skill-b" },
			],
			"v1.0.0",
		);

		// Remove both and tag v2.0.0
		const git = simpleGit(repoDir);
		await rm(join(repoDir, "skills", "skill-a"), { recursive: true });
		await rm(join(repoDir, "skills", "skill-b"), { recursive: true });
		await git.add(".");
		await git.commit("Remove both skills");
		await git.addTag("v2.0.0");

		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const manifest: Manifest = {
			dependencies: {
				"skill-a": {
					repo: `file://${bareDir}`,
					path: "skills/skill-a",
					version: "^2.0.0",
				},
				"skill-b": {
					repo: `file://${bareDir}`,
					path: "skills/skill-b",
					version: "^2.0.0",
				},
			},
		};

		const result = await resolveAll(manifest, dir);
		// Both should be reported, not just the first
		expect(result.errors.length).toBeGreaterThanOrEqual(2);
		expect(result.errors.some((e) => e.includes("skill-a"))).toBe(true);
		expect(result.errors.some((e) => e.includes("skill-b"))).toBe(true);
	});
});

describe("installer: copyFromGitCache with missing path", () => {
	test("gives a descriptive error when skill path does not exist at ref", async () => {
		const dir = await makeTempDir();

		// Create a repo, tag it, then remove the skill for a new tag
		const repoDir = await createTestRepo(
			dir,
			"remote",
			[{ path: "skills/gone-skill", name: "gone-skill" }],
			"v1.0.0",
		);

		const git = simpleGit(repoDir);
		await rm(join(repoDir, "skills", "gone-skill"), { recursive: true });
		await git.add(".");
		await git.commit("Remove gone-skill");
		await git.addTag("v2.0.0");

		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		// Manually build a resolved entity that points to a missing path
		// (simulates what would happen if validation was bypassed)
		const bareGit = simpleGit(bareDir);
		const commit = (await bareGit.revparse(["v2.0.0"])).trim();

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:gone-skill",
				{
					key: "gone-skill",
					name: "gone-skill",
					type: "skill",
					group: "prod",
					repo: `file://${bareDir}`,
					path: "skills/gone-skill",
					version: "2.0.0",
					tag: "v2.0.0",
					commit,
					local: false,
					dependencies: [],
					cachePath: bareDir,
				},
			],
		]);

		const installBase = join(dir, ".claude");
		const plan = await planInstall(entities, ["skill:gone-skill"], installBase, {});

		// Should throw a descriptive error, not a raw git error
		await expect(executeInstall(plan, dir, {})).rejects.toThrow(
			/gone-skill.*not found|not found.*gone-skill/i,
		);
	});

	test("gives a descriptive error when agent file does not exist at ref", async () => {
		const dir = await makeTempDir();

		const repoDir = await createTestRepo(
			dir,
			"remote",
			[{ path: "agents/gone-agent.md", name: "gone-agent", isAgent: true }],
			"v1.0.0",
		);

		const git = simpleGit(repoDir);
		await rm(join(repoDir, "agents", "gone-agent.md"));
		await git.add(".");
		await git.commit("Remove gone-agent");
		await git.addTag("v2.0.0");

		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const bareGit = simpleGit(bareDir);
		const commit = (await bareGit.revparse(["v2.0.0"])).trim();

		const entities = new Map<string, ResolvedEntity>([
			[
				"agent:gone-agent",
				{
					key: "gone-agent",
					name: "gone-agent",
					type: "agent",
					group: "prod",
					repo: `file://${bareDir}`,
					path: "agents/gone-agent.md",
					version: "2.0.0",
					tag: "v2.0.0",
					commit,
					local: false,
					dependencies: [],
					cachePath: bareDir,
				},
			],
		]);

		const installBase = join(dir, ".claude");
		const plan = await planInstall(entities, ["agent:gone-agent"], installBase, {});

		await expect(executeInstall(plan, dir, {})).rejects.toThrow(
			/gone-agent.*not found|not found.*gone-agent/i,
		);
	});
});
