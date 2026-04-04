import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedEntity } from "../../src/core/graph.js";
import { resolveAll, topologicalSort } from "../../src/core/graph.js";
import type { Manifest } from "../../src/types.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-graph-unhappy-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("longer cycle detection", () => {
	test("detects 3-node cycle: A→B→C→A", () => {
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
					dependencies: ["c"],
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
					dependencies: ["a"],
				},
			],
		]);

		const errors: string[] = [];
		topologicalSort(entities, context, errors);
		expect(errors.some((e) => e.includes("Circular dependency"))).toBe(true);
	});

	test("detects 4-node cycle: A→B→C→D→A", () => {
		const context = new Map<string, string>([
			["a", "skill:a"],
			["b", "skill:b"],
			["c", "skill:c"],
			["d", "skill:d"],
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
					dependencies: ["c"],
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
				"skill:d",
				{
					key: "d",
					name: "d",
					type: "skill",
					group: "prod",
					path: "d",
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

	test("cycle in subgraph does not affect non-cyclic nodes", () => {
		// E (no deps), A→B→C→A (cycle). E should still appear in sorted output.
		const context = new Map<string, string>([
			["a", "skill:a"],
			["b", "skill:b"],
			["c", "skill:c"],
			["e", "skill:e"],
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
					dependencies: ["c"],
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
					dependencies: ["a"],
				},
			],
			[
				"skill:e",
				{
					key: "e",
					name: "e",
					type: "skill",
					group: "prod",
					path: "e",
					commit: "x",
					local: true,
					dependencies: [],
				},
			],
		]);

		const errors: string[] = [];
		const order = topologicalSort(entities, context, errors);
		expect(errors.some((e) => e.includes("Circular dependency"))).toBe(true);
		// Non-cyclic node E should still be in the result
		expect(order).toContain("skill:e");
	});
});

describe("agent depending on agent", () => {
	test("agent can depend on another agent (valid)", async () => {
		const dir = await makeTempDir();
		await mkdir(join(dir, "agents"), { recursive: true });
		await writeFile(
			join(dir, "agents", "base-agent.md"),
			"---\nname: base-agent\n---\n\n# Base Agent\n",
		);
		await writeFile(
			join(dir, "agents", "top-agent.md"),
			"---\nname: top-agent\ndependencies:\n  - base-agent\n---\n\n# Top Agent\n",
		);

		const manifest: Manifest = {
			dependencies: {
				"base-agent": { local: "./agents/base-agent.md", type: "agent" },
				"top-agent": { local: "./agents/top-agent.md", type: "agent" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		expect(result.entities.has("agent:base-agent")).toBe(true);
		expect(result.entities.has("agent:top-agent")).toBe(true);

		// base-agent should come before top-agent in install order
		const baseIdx = result.installOrder.indexOf("agent:base-agent");
		const topIdx = result.installOrder.indexOf("agent:top-agent");
		expect(baseIdx).toBeLessThan(topIdx);
	});

	test("agent can depend on both skill and agent", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await mkdir(join(dir, "agents"), { recursive: true });
		await writeFile(
			join(dir, "agents", "helper-agent.md"),
			"---\nname: helper-agent\n---\n\n# Helper\n",
		);
		await writeFile(
			join(dir, "agents", "main-agent.md"),
			"---\nname: main-agent\ndependencies:\n  - my-skill\n  - helper-agent\n---\n\n# Main\n",
		);

		const manifest: Manifest = {
			dependencies: {
				"my-skill": { local: "./skills/my-skill" },
				"helper-agent": { local: "./agents/helper-agent.md", type: "agent" },
				"main-agent": { local: "./agents/main-agent.md", type: "agent" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		expect(result.entities.size).toBe(3);
	});
});

describe("multiple unresolvable transitive deps collected at once", () => {
	test("reports all missing deps, not just the first", async () => {
		const dir = await makeTempDir();
		// Skill declares 3 deps, none exist
		await createLocalSkill(join(dir, "skills"), "broken", ["missing-a", "missing-b", "missing-c"]);

		const manifest: Manifest = {
			dependencies: {
				broken: { local: "./skills/broken" },
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors.length).toBe(3);
		expect(result.errors.some((e) => e.includes("missing-a"))).toBe(true);
		expect(result.errors.some((e) => e.includes("missing-b"))).toBe(true);
		expect(result.errors.some((e) => e.includes("missing-c"))).toBe(true);
	});
});

describe("local dep path does not exist", () => {
	test("resolveAll does not crash on non-existent local path", async () => {
		const dir = await makeTempDir();
		const manifest: Manifest = {
			dependencies: {
				ghost: { local: "./skills/does-not-exist" },
			},
		};

		// Should not throw — resolveAll should handle gracefully
		const result = await resolveAll(manifest, dir);
		// Entity should still be created (type inferred as skill by default)
		expect(result.entities.has("skill:ghost")).toBe(true);
	});
});
