import { describe, expect, test } from "bun:test";
import type { ResolvedEntity } from "../../src/core/graph.js";
import {
	buildLockfile,
	buildNameIndex,
	parseLockfile,
	serializeLockfile,
} from "../../src/core/lockfile.js";
import type { Lockfile } from "../../src/types.js";

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

	// Issue #102: cycles routed through aliased entries (alias ≠ name) must
	// still be caught. Before the fix, `assertAcyclic` looked up children via
	// raw `packages[childRef]` and missed alias-targeted edges entirely.
	test("rejects a dependency cycle routed through an aliased entry (issue #102)", () => {
		const cyclic = [
			"lockfile_version: 1",
			"packages:",
			"  pc: {type: skill, group: prod, source: local, path: ./pc, commit: HEAD,",
			"       name: python-coding, dependencies: [task-builder]}",
			"  task-builder: {type: skill, group: prod, source: local, path: ./tb,",
			"                 commit: HEAD, dependencies: [python-coding]}",
			"",
		].join("\n");
		expect(() => parseLockfile(cyclic)).toThrow(/cycle detected/);
	});
});

describe("buildNameIndex (issue #102)", () => {
	function fixture(entries: ReadonlyArray<{ key: string; name?: string }>): Lockfile {
		const packages: Lockfile["packages"] = {};
		for (const { key, name } of entries) {
			packages[key] = {
				type: "skill",
				group: "prod",
				path: `./${key}`,
				commit: "HEAD",
				dependencies: [],
				...(name !== undefined ? { name } : {}),
			};
		}
		return { lockfile_version: 1, packages };
	}

	// Parametrized: a single helper, many shape variants — when a new edge
	// case shows up, add a row, get the coverage in one place. (CLAUDE.md
	// hardening pattern #4.)
	test.each([
		// alias-only: name field absent → identity mapping
		{ name: "no alias", entries: [{ key: "a" }], ref: "a", expectedKey: "a" },
		// alias === name (explicitly): still identity, no second mapping
		{ name: "alias equals name", entries: [{ key: "a", name: "a" }], ref: "a", expectedKey: "a" },
		// classic alias: lookup by name resolves to the YAML key
		{
			name: "alias by name",
			entries: [{ key: "pc", name: "python-coding" }],
			ref: "python-coding",
			expectedKey: "pc",
		},
		// classic alias: lookup by YAML key still resolves to itself
		{
			name: "alias by key",
			entries: [{ key: "pc", name: "python-coding" }],
			ref: "pc",
			expectedKey: "pc",
		},
		// unknown ref: no match
		{ name: "unknown ref", entries: [{ key: "a" }], ref: "ghost", expectedKey: undefined },
	])("$name", ({ entries, ref, expectedKey }) => {
		const lockfile = fixture(entries);
		const index = buildNameIndex(lockfile);
		if (expectedKey === undefined) {
			expect(index.get(ref)).toBeUndefined();
		} else {
			expect(index.get(ref)).toBe(expectedKey);
		}
	});

	// Disambiguation collisions across types fall back to last-one-wins
	// (matches install-time `useExistingResolution` behavior). Document the
	// contract explicitly so a future "fix" doesn't quietly change it.
	test("collision: two entries share a name → last write wins", () => {
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				"foo-skill": {
					type: "skill",
					group: "prod",
					path: "./fs",
					commit: "HEAD",
					name: "foo",
					dependencies: [],
				},
				"foo-agent": {
					type: "agent",
					group: "prod",
					path: "./fa",
					commit: "HEAD",
					name: "foo",
					dependencies: [],
				},
			},
		};
		const index = buildNameIndex(lockfile);
		// Whichever entry was iterated last wins; both YAML keys still
		// resolve via identity. We don't assert which one wins (insertion
		// order over Object.entries can change with future runtimes); we
		// just assert the contract: name → some real key from the lockfile.
		const winner = index.get("foo");
		expect(winner).toBeDefined();
		expect(["foo-skill", "foo-agent"]).toContain(winner as string);
		expect(index.get("foo-skill")).toBe("foo-skill");
		expect(index.get("foo-agent")).toBe("foo-agent");
	});
});
