import { describe, expect, test } from "bun:test";
import type { ResolvedEntity } from "../../src/core/graph.js";
import { buildLockfile, parseLockfile, serializeLockfile } from "../../src/core/lockfile.js";

describe("buildLockfile", () => {
	test("builds lockfile from resolved entities", () => {
		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:python-coding",
				{
					key: "python-coding",
					name: "python-coding",
					type: "skill",
					group: "prod",
					repo: "github.com/user/skills",
					path: "skills/python-coding",
					version: "2.1.3",
					tag: "v2.1.3",
					commit: "abc123",
					local: false,
					dependencies: [],
				},
			],
			[
				"skill:testing",
				{
					key: "testing",
					name: "testing",
					type: "skill",
					group: "prod",
					repo: "github.com/user/skills",
					path: "skills/testing",
					version: "2.1.3",
					tag: "v2.1.3",
					commit: "abc123",
					local: false,
					dependencies: ["python-coding"],
				},
			],
		]);

		const lockfile = buildLockfile(entities);
		expect(lockfile.lockfile_version).toBe(1);
		expect(lockfile.packages["python-coding"]?.type).toBe("skill");
		expect(lockfile.packages["python-coding"]?.dependencies).toEqual([]);
		expect(lockfile.packages.testing?.dependencies).toEqual(["python-coding"]);
	});

	test("marks local deps with source: local", () => {
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

		const lockfile = buildLockfile(entities);
		expect(lockfile.packages["my-skill"]?.source).toBe("local");
		expect(lockfile.packages["my-skill"]?.repo).toBeUndefined();
	});

	test("includes name field for aliased entries", () => {
		const entities = new Map<string, ResolvedEntity>([
			[
				"agent:workflow-builder",
				{
					key: "workflow-builder-agent",
					name: "workflow-builder",
					type: "agent",
					group: "prod",
					path: "./agents/workflow-builder.md",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const lockfile = buildLockfile(entities);
		expect(lockfile.packages["workflow-builder-agent"]?.name).toBe("workflow-builder");
	});
});

describe("serializeLockfile + parseLockfile roundtrip", () => {
	test("roundtrips correctly", () => {
		const original = {
			lockfile_version: 1 as const,
			packages: {
				"python-coding": {
					type: "skill" as const,
					group: "prod" as const,
					repo: "github.com/user/skills",
					path: "skills/python-coding",
					version: "2.1.3",
					commit: "abc123",
					integrity: "sha256-xxx",
					dependencies: [],
				},
			},
		};

		const serialized = serializeLockfile(original);
		expect(serialized).toContain("DO NOT EDIT MANUALLY");

		const parsed = parseLockfile(serialized);
		expect(parsed.lockfile_version).toBe(1);
		expect(parsed.packages["python-coding"]?.version).toBe("2.1.3");
	});
});

describe("parseLockfile", () => {
	test("throws on corrupted content", () => {
		expect(() => parseLockfile("not: valid: yaml: [}")).toThrow();
	});

	test("throws on unsupported version", () => {
		expect(() => parseLockfile("lockfile_version: 99\npackages: {}")).toThrow(
			"Unsupported lockfile version",
		);
	});

	test("rejects a lockfile with a dependency cycle (issue #47)", () => {
		// The resolver rejects cycles, so any cycle in a lockfile is corruption.
		// Validate at read time so all consumers (deps tree, install --frozen)
		// surface a clear error instead of silently mishandling the bad data.
		const cyclic = [
			"lockfile_version: 1",
			"packages:",
			"  a: {type: skill, group: prod, source: local, path: ./a, commit: HEAD, dependencies: [b]}",
			"  b: {type: skill, group: prod, source: local, path: ./b, commit: HEAD, dependencies: [a]}",
			"",
		].join("\n");
		expect(() => parseLockfile(cyclic)).toThrow(/cycle detected.*a → b → a/);
	});

	test("self-cycle is rejected (issue #47)", () => {
		const selfCycle = [
			"lockfile_version: 1",
			"packages:",
			"  a: {type: skill, group: prod, source: local, path: ./a, commit: HEAD, dependencies: [a]}",
			"",
		].join("\n");
		expect(() => parseLockfile(selfCycle)).toThrow(/cycle detected.*a → a/);
	});
});
