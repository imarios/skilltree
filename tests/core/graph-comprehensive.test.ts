/**
 * Pre-refactoring tests for complex graph.ts functions:
 * - resolveAll (36), resolveTransitive (54), resolveLocalEntity (31),
 *   resolveRemoteEntity (31), topologicalSort (28), inferTypeFromGit (26)
 *
 * These tests exercise specific branches to ensure refactoring doesn't break them.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { ResolvedEntity } from "../../src/core/graph.js";
import { inferTypeFromGit, resolveAll, topologicalSort } from "../../src/core/graph.js";
import type { Manifest } from "../../src/types.js";
import { createLocalSkill, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-graph-comp-"));
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

describe("resolveAll: repo version intersection", () => {
	test("intersects multiple constraints from same repo", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"multi-constraint",
			[
				{ path: "skills/skill-a", name: "skill-a" },
				{ path: "skills/skill-b", name: "skill-b" },
			],
			"v1.5.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "bare");

		const manifest: Manifest = {
			dependencies: {
				"skill-a": {
					repo: `file://${bareDir}`,
					path: "skills/skill-a",
					version: "^1.0.0",
				},
				"skill-b": {
					repo: `file://${bareDir}`,
					path: "skills/skill-b",
					version: ">=1.5.0",
				},
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		// Both should resolve to 1.5.0 (satisfies both ^1.0.0 and >=1.5.0)
		expect(result.entities.get("skill:skill-a")?.version).toBe("1.5.0");
		expect(result.entities.get("skill:skill-b")?.version).toBe("1.5.0");
	});

	test("tagless repo falls back to default branch with warning", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"tagless",
			[{ path: "skills/my-skill", name: "my-skill" }],
			// no tag
		);
		const bareDir = await makeBareClone(repoDir, dir, "bare");

		const manifest: Manifest = {
			dependencies: {
				"my-skill": { repo: `file://${bareDir}`, path: "skills/my-skill", version: "*" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		expect(result.warnings.some((w) => w.includes("no version tags"))).toBe(true);
		expect(result.entities.get("skill:my-skill")?.version).toBeUndefined();
	});
});

describe("resolveAll: group assignment", () => {
	test("dev-dep that is also transitive prod dep gets group prod", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "shared");
		await createLocalSkill(join(dir, "skills"), "prod-parent", ["shared"]);
		await createLocalSkill(join(dir, "skills"), "dev-only");

		const manifest: Manifest = {
			dependencies: {
				"prod-parent": { local: "./skills/prod-parent" },
				shared: { local: "./skills/shared" },
			},
			"dev-dependencies": {
				"dev-only": { local: "./skills/dev-only" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:shared")?.group).toBe("prod");
		expect(result.entities.get("skill:dev-only")?.group).toBe("dev");
	});
});

describe("resolveAll: error collection", () => {
	test("collects multiple errors without halting on first", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "bad-a", ["missing-x"]);
		await createLocalSkill(join(dir, "skills"), "bad-b", ["missing-y"]);

		const manifest: Manifest = {
			dependencies: {
				"bad-a": { local: "./skills/bad-a" },
				"bad-b": { local: "./skills/bad-b" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors.length).toBe(2);
		expect(result.errors.some((e) => e.includes("missing-x"))).toBe(true);
		expect(result.errors.some((e) => e.includes("missing-y"))).toBe(true);
	});
});

describe("resolveAll: same-repo transitive resolution for remote deps", () => {
	test("finds transitive dep in same repo automatically", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"same-repo",
			[
				{ path: "skills/leaf", name: "leaf" },
				{ path: "skills/parent", name: "parent", dependencies: ["leaf"] },
			],
			"v1.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "bare");

		const manifest: Manifest = {
			dependencies: {
				parent: { repo: `file://${bareDir}`, path: "skills/parent", version: "*" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		expect(result.entities.has("skill:leaf")).toBe(true);
	});

	test("cross-repo transitive dep must be in manifest", async () => {
		const dir = await makeTempDir();
		const repo1Dir = await createTestRepo(
			dir,
			"repo1",
			[{ path: "skills/parent", name: "parent", dependencies: ["external-dep"] }],
			"v1.0.0",
		);
		const bare1Dir = await makeBareClone(repo1Dir, dir, "bare1");

		const manifest: Manifest = {
			dependencies: {
				parent: { repo: `file://${bare1Dir}`, path: "skills/parent", version: "*" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0]).toContain("external-dep");
	});
});

describe("resolveAll: cross-type dependencies (issue #45)", () => {
	test("skill depending on agent resolves cleanly", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill", ["my-agent"]);
		await mkdir(join(dir, "agents"), { recursive: true });
		await writeFile(join(dir, "agents", "my-agent.md"), "---\nname: my-agent\n---\n\n# Agent\n");

		const manifest: Manifest = {
			dependencies: {
				"my-skill": { local: "./skills/my-skill" },
				"my-agent": { local: "./agents/my-agent.md", type: "agent" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:my-skill")).toBeDefined();
		expect(result.entities.get("agent:my-agent")).toBeDefined();
	});

	test("agent depending on skill is valid", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await mkdir(join(dir, "agents"), { recursive: true });
		await writeFile(
			join(dir, "agents", "my-agent.md"),
			"---\nname: my-agent\ndependencies:\n  - my-skill\n---\n\n# Agent\n",
		);

		const manifest: Manifest = {
			dependencies: {
				"my-skill": { local: "./skills/my-skill" },
				"my-agent": { local: "./agents/my-agent.md", type: "agent" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
	});
});

describe("resolveAll: duplicate detection", () => {
	test("same name + type from two manifest entries is an error", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "dupe");
		await createLocalSkill(join(dir, "other"), "dupe");

		const manifest: Manifest = {
			dependencies: {
				dupe: { local: "./skills/dupe" },
				"dupe-alias": { local: "./other/dupe", name: "dupe" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors.some((e) => e.includes("Duplicate entity resolution"))).toBe(true);
	});

	test("transitive dep matching manifest entry is NOT a duplicate", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "child");
		await createLocalSkill(join(dir, "skills"), "parent", ["child"]);

		const manifest: Manifest = {
			dependencies: {
				parent: { local: "./skills/parent" },
				child: { local: "./skills/child" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
	});
});

describe("topologicalSort: edge cases", () => {
	test("deterministic output for independent nodes", () => {
		const context = new Map<string, string>([
			["z", "skill:z"],
			["a", "skill:a"],
			["m", "skill:m"],
		]);
		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:z",
				{
					key: "z",
					name: "z",
					type: "skill",
					group: "prod",
					path: "z",
					commit: "x",
					local: true,
					dependencies: [],
				},
			],
			[
				"skill:a",
				{
					key: "a",
					name: "a",
					type: "skill",
					group: "prod",
					path: "a",
					commit: "x",
					local: true,
					dependencies: [],
				},
			],
			[
				"skill:m",
				{
					key: "m",
					name: "m",
					type: "skill",
					group: "prod",
					path: "m",
					commit: "x",
					local: true,
					dependencies: [],
				},
			],
		]);

		const errors: string[] = [];
		const order = topologicalSort(entities, context, errors);
		expect(errors).toEqual([]);
		// Should be alphabetical for determinism
		expect(order).toEqual(["skill:a", "skill:m", "skill:z"]);
	});

	test("deep chain preserves order", () => {
		const names = ["a", "b", "c", "d", "e"];
		const context = new Map(names.map((n) => [n, `skill:${n}`]));
		const entities = new Map<string, ResolvedEntity>();
		for (let i = 0; i < names.length; i++) {
			const n = names[i] as string;
			entities.set(`skill:${n}`, {
				key: n,
				name: n,
				type: "skill",
				group: "prod",
				path: n,
				commit: "x",
				local: true,
				dependencies: i > 0 ? [names[i - 1] as string] : [],
			});
		}

		const errors: string[] = [];
		const order = topologicalSort(entities, context, errors);
		expect(errors).toEqual([]);
		// a before b before c before d before e
		for (let i = 1; i < names.length; i++) {
			expect(order.indexOf(`skill:${names[i]}`)).toBeGreaterThan(
				order.indexOf(`skill:${names[i - 1]}`),
			);
		}
	});

	test("handles deps referencing non-existent entities gracefully", () => {
		const context = new Map<string, string>([["a", "skill:a"]]);
		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:a",
				{
					key: "a",
					name: "a",
					type: "skill",
					group: "prod",
					path: "a",
					commit: "x",
					local: true,
					dependencies: ["nonexistent"],
				},
			],
		]);

		const errors: string[] = [];
		const order = topologicalSort(entities, context, errors);
		// Should still sort what it can — nonexistent dep is just ignored
		expect(order).toContain("skill:a");
	});
});

describe("resolveAll: source expansion and local sources", () => {
	test("source dependency with remote URL expands to repo", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"source-repo",
			[{ path: "skills/my-skill", name: "my-skill" }],
			"v1.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "bare");

		const manifest: Manifest = {
			sources: { org: `file://${bareDir}` },
			dependencies: {
				"my-skill": { source: "org", path: "skills/my-skill", version: "*" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:my-skill")?.repo).toBe(`file://${bareDir}`);
	});
});

describe("inferTypeFromGit: edge cases", () => {
	test("non-existent path falls back to type based on extension", async () => {
		const dir = await makeTempDir();
		const repoDir = join(dir, "repo");
		await mkdir(repoDir, { recursive: true });
		const git = simpleGit(repoDir);
		await git.init();
		await git.addConfig("user.email", "test@test.com");
		await git.addConfig("user.name", "Test");
		await writeFile(join(repoDir, "placeholder.txt"), "content");
		await git.add(".");
		await git.commit("init");
		await git.addTag("v1.0.0");
		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		// Path doesn't exist in the repo
		const result = await inferTypeFromGit(bareDir, "v1.0.0", "nonexistent/path");
		expect(result.type).toBe("skill"); // default fallback

		const resultMd = await inferTypeFromGit(bareDir, "v1.0.0", "nonexistent.md");
		expect(resultMd.type).toBe("agent"); // .md → agent
	});
});
