import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { ResolvedEntity } from "../../src/core/graph.js";
import { resolveAll, topologicalSort } from "../../src/core/graph.js";
import type { Manifest } from "../../src/types.js";
import { createLocalSkill, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-graph-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("topologicalSort", () => {
	test("sorts simple chain A -> B -> C", () => {
		const context = new Map<string, string>([
			["a", "skill:a"],
			["b", "skill:b"],
			["c", "skill:c"],
		]);
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
					dependencies: [],
				},
			],
			[
				"skill:b",
				{
					key: "b",
					name: "b",
					type: "skill",
					group: "prod",
					path: "b",
					commit: "x",
					local: true,
					dependencies: ["a"],
				},
			],
			[
				"skill:c",
				{
					key: "c",
					name: "c",
					type: "skill",
					group: "prod",
					path: "c",
					commit: "x",
					local: true,
					dependencies: ["b"],
				},
			],
		]);

		const errors: string[] = [];
		const order = topologicalSort(entities, context, errors);
		expect(errors).toEqual([]);
		expect(order).toEqual(["skill:a", "skill:b", "skill:c"]);
	});

	test("sorts diamond dependency A->B, A->C, B->D, C->D", () => {
		const context = new Map<string, string>([
			["a", "skill:a"],
			["b", "skill:b"],
			["c", "skill:c"],
			["d", "skill:d"],
		]);
		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:d",
				{
					key: "d",
					name: "d",
					type: "skill",
					group: "prod",
					path: "d",
					commit: "x",
					local: true,
					dependencies: [],
				},
			],
			[
				"skill:b",
				{
					key: "b",
					name: "b",
					type: "skill",
					group: "prod",
					path: "b",
					commit: "x",
					local: true,
					dependencies: ["d"],
				},
			],
			[
				"skill:c",
				{
					key: "c",
					name: "c",
					type: "skill",
					group: "prod",
					path: "c",
					commit: "x",
					local: true,
					dependencies: ["d"],
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
					dependencies: ["b", "c"],
				},
			],
		]);

		const errors: string[] = [];
		const order = topologicalSort(entities, context, errors);
		expect(errors).toEqual([]);
		// d must come before b and c, which must come before a
		expect(order.indexOf("skill:d")).toBeLessThan(order.indexOf("skill:b"));
		expect(order.indexOf("skill:d")).toBeLessThan(order.indexOf("skill:c"));
		expect(order.indexOf("skill:b")).toBeLessThan(order.indexOf("skill:a"));
		expect(order.indexOf("skill:c")).toBeLessThan(order.indexOf("skill:a"));
	});

	test("detects cycles", () => {
		const context = new Map<string, string>([
			["a", "skill:a"],
			["b", "skill:b"],
		]);
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
					dependencies: ["b"],
				},
			],
			[
				"skill:b",
				{
					key: "b",
					name: "b",
					type: "skill",
					group: "prod",
					path: "b",
					commit: "x",
					local: true,
					dependencies: ["a"],
				},
			],
		]);

		const errors: string[] = [];
		topologicalSort(entities, context, errors);
		expect(errors.some((e) => e.includes("Circular dependency"))).toBe(true);
	});

	test("handles independent nodes (no deps)", () => {
		const context = new Map<string, string>([
			["x", "skill:x"],
			["y", "skill:y"],
			["z", "skill:z"],
		]);
		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:x",
				{
					key: "x",
					name: "x",
					type: "skill",
					group: "prod",
					path: "x",
					commit: "x",
					local: true,
					dependencies: [],
				},
			],
			[
				"skill:y",
				{
					key: "y",
					name: "y",
					type: "skill",
					group: "prod",
					path: "y",
					commit: "x",
					local: true,
					dependencies: [],
				},
			],
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
		]);

		const errors: string[] = [];
		const order = topologicalSort(entities, context, errors);
		expect(errors).toEqual([]);
		// Alphabetical order for determinism
		expect(order).toEqual(["skill:x", "skill:y", "skill:z"]);
	});
});

describe("resolveAll with local deps", () => {
	test("resolves a single local skill with no dependencies", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");

		const manifest: Manifest = {
			dependencies: {
				"my-skill": { local: "./skills/my-skill" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		expect(result.entities.size).toBe(1);
		expect(result.entities.has("skill:my-skill")).toBe(true);
		expect(result.installOrder).toEqual(["skill:my-skill"]);
	});

	test("resolves local skills with transitive dependencies", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "base-skill");
		await createLocalSkill(join(dir, "skills"), "mid-skill", ["base-skill"]);
		await createLocalSkill(join(dir, "skills"), "top-skill", ["mid-skill"]);

		const manifest: Manifest = {
			dependencies: {
				"top-skill": { local: "./skills/top-skill" },
				"mid-skill": { local: "./skills/mid-skill" },
				"base-skill": { local: "./skills/base-skill" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		expect(result.entities.size).toBe(3);
		// base before mid before top
		const order = result.installOrder;
		expect(order.indexOf("skill:base-skill")).toBeLessThan(order.indexOf("skill:mid-skill"));
		expect(order.indexOf("skill:mid-skill")).toBeLessThan(order.indexOf("skill:top-skill"));
	});

	test("reports unresolvable transitive dependency", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "broken-skill", ["nonexistent-dep"]);

		const manifest: Manifest = {
			dependencies: {
				"broken-skill": { local: "./skills/broken-skill" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors.some((e) => e.includes("nonexistent-dep"))).toBe(true);
	});

	test("filters self-references in frontmatter", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "self-ref", ["self-ref"]);

		const manifest: Manifest = {
			dependencies: {
				"self-ref": { local: "./skills/self-ref" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		const entity = result.entities.get("skill:self-ref");
		expect(entity?.dependencies).toEqual([]);
	});

	test("group assignment: transitive dep reachable from prod gets prod", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "shared");
		await createLocalSkill(join(dir, "skills"), "prod-user", ["shared"]);
		await createLocalSkill(join(dir, "skills"), "dev-user", ["shared"]);

		const manifest: Manifest = {
			dependencies: {
				"prod-user": { local: "./skills/prod-user" },
				shared: { local: "./skills/shared" },
			},
			"dev-dependencies": {
				"dev-user": { local: "./skills/dev-user" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		const shared = result.entities.get("skill:shared");
		expect(shared?.group).toBe("prod");
	});

	test("dev→prod promotion is type-agnostic: a command first reached via dev gets promoted (issue #45)", async () => {
		// useExistingResolution does not branch on entity type when promoting
		// a transitive dep from dev to prod — verify that holds for commands
		// now that skill→command is allowed.
		const dir = await makeTempDir();
		const { mkdir: mkdirFs } = await import("node:fs/promises");
		await createLocalSkill(join(dir, "skills"), "prod-user", ["shared-cmd"]);
		await createLocalSkill(join(dir, "skills"), "dev-user", ["shared-cmd"]);
		await mkdirFs(join(dir, "commands"), { recursive: true });
		await writeFile(join(dir, "commands", "shared-cmd.md"), "---\nname: shared-cmd\n---\nBody\n");

		// Order matters: dev-dependencies process AFTER dependencies in
		// resolveAll. Put the dev parent first to make sure the command
		// is reached *first* via dev — the prod sweep then promotes it.
		const manifest: Manifest = {
			dependencies: {
				"prod-user": { local: "./skills/prod-user" },
			},
			"dev-dependencies": {
				"dev-user": { local: "./skills/dev-user" },
				"shared-cmd": { local: "./commands/shared-cmd.md", type: "command" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		expect(result.entities.get("command:shared-cmd")?.group).toBe("prod");
	});

	test("same-name skill+command: a transitive `foo` resolves to the skill, not the command (issue #45)", async () => {
		// With skill→command now allowed, a manifest can legitimately declare
		// both `skill:foo` and `command:foo`. Decision #7 says skill wins for
		// disambiguation; the registerEntity skill-priority guard enforces it
		// regardless of registration order.
		const dir = await makeTempDir();
		const { mkdir: mkdirFs } = await import("node:fs/promises");
		await createLocalSkill(join(dir, "skills"), "parent", ["foo"]);
		await createLocalSkill(join(dir, "skills"), "foo");
		await mkdirFs(join(dir, "commands"), { recursive: true });
		await writeFile(join(dir, "commands", "foo.md"), "---\nname: foo\n---\nBody\n");

		const manifest: Manifest = {
			dependencies: {
				parent: { local: "./skills/parent" },
				foo: { local: "./skills/foo" },
				"foo-cmd": { local: "./commands/foo.md", type: "command", name: "foo" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		// parent's transitive `foo` must hit the skill, not the command —
		// proven by the skill being in the install order ahead of parent.
		const order = result.installOrder;
		expect(order).toContain("skill:foo");
		expect(order).toContain("command:foo");
		expect(order.indexOf("skill:foo")).toBeLessThan(order.indexOf("skill:parent"));
	});

	test("skill can depend on agent (issue #45)", async () => {
		// Slash commands and agents are reusable, composable workflows; a
		// skill that prescribes a workflow naturally references them.
		const dir = await makeTempDir();
		const { mkdir: mkdirFs } = await import("node:fs/promises");
		await mkdirFs(join(dir, "agents"), { recursive: true });
		await writeFile(join(dir, "agents", "my-agent.md"), "---\nname: my-agent\n---\n\n# Agent\n");
		await createLocalSkill(join(dir, "skills"), "my-skill", ["my-agent"]);

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
});

describe("resolveAll with remote deps", () => {
	test("resolves remote dep from a local git repo", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"remote",
			[{ path: "skills/remote-skill", name: "remote-skill" }],
			"v1.0.0",
		);

		// Create bare clone (simulates what ensureCached does)
		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const manifest: Manifest = {
			dependencies: {
				"remote-skill": {
					repo: `file://${bareDir}`,
					path: "skills/remote-skill",
					version: "*",
				},
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		expect(result.entities.has("skill:remote-skill")).toBe(true);
		const entity = result.entities.get("skill:remote-skill");
		expect(entity?.version).toBe("1.0.0");
	});

	test("resolves transitive deps from same repo (same-repo default)", async () => {
		const dir = await makeTempDir();
		// Create repo with parent skill depending on child skill
		const repoDir = await createTestRepo(
			dir,
			"multi",
			[
				{ path: "skills/child", name: "child" },
				{ path: "skills/parent", name: "parent", dependencies: ["child"] },
			],
			"v2.0.0",
		);

		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const manifest: Manifest = {
			dependencies: {
				parent: {
					repo: `file://${bareDir}`,
					path: "skills/parent",
					version: "*",
				},
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		// Both parent and child should be resolved
		expect(result.entities.has("skill:parent")).toBe(true);
		expect(result.entities.has("skill:child")).toBe(true);
		// child should be installed before parent
		const parentIdx = result.installOrder.indexOf("skill:parent");
		const childIdx = result.installOrder.indexOf("skill:child");
		expect(childIdx).toBeLessThan(parentIdx);
	});

	test("reports error for unresolvable transitive dep from remote", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"broken",
			[{ path: "skills/broken-parent", name: "broken-parent", dependencies: ["nonexistent"] }],
			"v1.0.0",
		);

		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const manifest: Manifest = {
			dependencies: {
				"broken-parent": {
					repo: `file://${bareDir}`,
					path: "skills/broken-parent",
					version: "*",
				},
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors.some((e) => e.includes("nonexistent"))).toBe(true);
	});
});

describe("duplicate composite key detection", () => {
	test("errors when two manifest entries resolve to same (type, name)", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "dupe-skill");
		await createLocalSkill(join(dir, "other-skills"), "dupe-skill");

		const manifest: Manifest = {
			dependencies: {
				"dupe-skill": { local: "./skills/dupe-skill" },
				"dupe-skill-alias": { local: "./other-skills/dupe-skill", name: "dupe-skill" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors.some((e) => e.includes("Duplicate entity resolution"))).toBe(true);
	});

	test("no false positive when transitive dep matches manifest entry", async () => {
		const dir = await makeTempDir();
		// parent depends on child via frontmatter. child is also directly in manifest.
		// This is NOT a duplicate — the manifest entry should take priority silently.
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
		expect(result.entities.has("skill:child")).toBe(true);
		expect(result.entities.has("skill:parent")).toBe(true);
	});
});
