import { describe, expect, test } from "bun:test";
import { scoreEntity, searchRegistries } from "../../src/core/registry-search.js";
import type { IndexEntry, RegistryIndex } from "../../src/types.js";

function makeIndex(registry: string, repo: string, entities: IndexEntry[]): RegistryIndex {
	return { registry, repo, updated_at: new Date().toISOString(), entities };
}

describe("scoreEntity", () => {
	test("single token matches name substring", () => {
		const entity: IndexEntry = {
			name: "python-coding",
			type: "skill",
			path: "skills/python-coding",
		};
		const score = scoreEntity(["python"], entity);
		expect(score).toBeGreaterThan(0);
	});

	test("exact name match scores highest", () => {
		const entity: IndexEntry = {
			name: "python-coding",
			type: "skill",
			path: "skills/python-coding",
			description: "Python development",
		};
		const exactScore = scoreEntity(["python-coding"], entity);
		const partialScore = scoreEntity(["python"], entity);
		expect(exactScore).toBeGreaterThan(partialScore);
	});

	test("tag match scores higher than description match", () => {
		const entityWithTag: IndexEntry = {
			name: "something",
			type: "skill",
			path: "skills/something",
			tags: ["python"],
		};
		const entityWithDesc: IndexEntry = {
			name: "something",
			type: "skill",
			path: "skills/something",
			description: "Uses python for stuff",
		};
		const tagScore = scoreEntity(["python"], entityWithTag);
		const descScore = scoreEntity(["python"], entityWithDesc);
		expect(tagScore).toBeGreaterThan(descScore);
	});

	test("case-insensitive matching", () => {
		const entity: IndexEntry = {
			name: "Python-Coding",
			type: "skill",
			path: "skills/python-coding",
			description: "PYTHON development",
			tags: ["Python"],
		};
		const score = scoreEntity(["python"], entity);
		expect(score).toBeGreaterThan(0);
	});

	test("returns 0 when token matches nothing (AND semantics)", () => {
		const entity: IndexEntry = {
			name: "python-coding",
			type: "skill",
			path: "skills/python-coding",
			description: "Python dev",
		};
		// "kubernetes" matches nothing
		const score = scoreEntity(["python", "kubernetes"], entity);
		expect(score).toBe(0);
	});

	test("multiple tokens all must match somewhere", () => {
		const entity: IndexEntry = {
			name: "python-coding",
			type: "skill",
			path: "skills/python-coding",
			description: "Python development with testing",
		};
		const score = scoreEntity(["python", "testing"], entity);
		expect(score).toBeGreaterThan(0);
	});
});

describe("searchRegistries", () => {
	const vibesIndex = makeIndex("vibes", "github.com/imarios/vibes", [
		{
			name: "python-coding",
			type: "skill",
			path: "skills/python-coding",
			description: "Python development with Poetry, PEP 8, pytest",
			tags: ["python", "testing"],
		},
		{
			name: "task-builder",
			type: "skill",
			path: "skills/task-builder",
			description: "Build security automation tasks",
			tags: ["security", "tasks"],
		},
		{
			name: "cybersecurity-analyst",
			type: "agent",
			path: "agents/cybersecurity-analyst.md",
			description: "Security investigation agent",
			tags: ["security", "soc"],
		},
	]);

	const communityIndex = makeIndex("community", "github.com/skillkit/community-skills", [
		{
			name: "python-testing",
			type: "skill",
			path: "skills/python-testing",
			description: "Python test utilities and fixtures",
			tags: ["python", "testing"],
		},
	]);

	test("returns matching results across registries", () => {
		const results = searchRegistries("python", [vibesIndex, communityIndex]);
		expect(results.length).toBeGreaterThanOrEqual(2);
		const names = results.map((r) => r.name);
		expect(names).toContain("python-coding");
		expect(names).toContain("python-testing");
	});

	test("results sorted by score descending", () => {
		const results = searchRegistries("python", [vibesIndex, communityIndex]);
		for (let i = 1; i < results.length; i++) {
			const curr = results[i];
			const prev = results[i - 1];
			expect(curr?.score).toBeLessThanOrEqual(prev?.score ?? 0);
		}
	});

	test("ties broken alphabetically by name", () => {
		// Both have "python" in name and tags — similar scores
		const results = searchRegistries("python", [vibesIndex, communityIndex]);
		const pythonResults = results.filter((r) => r.name.startsWith("python"));
		expect(pythonResults.length).toBe(2);
		const first = pythonResults[0];
		const second = pythonResults[1];
		// python-coding should come before python-testing alphabetically on tie
		if (first?.score === second?.score) {
			expect((first?.name ?? "") < (second?.name ?? "")).toBe(true);
		}
	});

	test("no results for query with zero matches", () => {
		const results = searchRegistries("kubernetes", [vibesIndex, communityIndex]);
		expect(results).toHaveLength(0);
	});

	test("--registry filters to one registry", () => {
		const results = searchRegistries("python", [vibesIndex, communityIndex], {
			registry: "vibes",
		});
		expect(results.every((r) => r.registry === "vibes")).toBe(true);
	});

	test("--type filters by entity type", () => {
		const results = searchRegistries("security", [vibesIndex], { type: "agent" });
		expect(results.every((r) => r.type === "agent")).toBe(true);
		expect(results.length).toBe(1);
		expect(results[0]?.name).toBe("cybersecurity-analyst");
	});

	test("includes registry and repo in results", () => {
		const results = searchRegistries("python-coding", [vibesIndex]);
		expect(results[0]?.registry).toBe("vibes");
		expect(results[0]?.repo).toBe("github.com/imarios/vibes");
	});
});
