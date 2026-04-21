import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAll } from "../../src/core/graph.js";
import { parseManifest, serializeManifest, validateManifest } from "../../src/core/manifest.js";
import type { Dependency, Manifest } from "../../src/types.js";
import { createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("R9 direct-dep path inference", () => {
	test("1. infers path from origin's local: entry", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r9-"));

		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  foo:",
			"    local: ./skills/source/foo",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/source/foo", name: "foo" }],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			dependencies: {
				foo: { repo: `file://${originRepo}`, version: "*" },
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		const foo = result.entities.get("skill:foo");
		expect(foo).toBeDefined();
		expect(foo?.path).toBe("skills/source/foo");
	});

	test("2. infers path from origin's same-repo repo: entry", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r9-"));

		// Origin declares `foo` pointing at itself with explicit path — consumer inherits.
		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  foo:",
			"    repo: __SELF__",
			"    path: skills/source/foo",
			`    version: "*"`,
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/source/foo", name: "foo" }],
			"v1.0.0",
			originManifestYaml.replace("__SELF__", `file://${join(tempDir, "origin")}`),
		);

		const consumerManifest: Manifest = {
			dependencies: {
				foo: { repo: `file://${originRepo}`, version: "*" },
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:foo")?.path).toBe("skills/source/foo");
	});

	test("3. infers path from source: alias without path:", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r9-"));

		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  foo:",
			"    local: ./skills/source/foo",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/source/foo", name: "foo" }],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			sources: { oo: `file://${originRepo}` },
			dependencies: {
				foo: { source: "oo", version: "*" } as Dependency,
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:foo")?.path).toBe("skills/source/foo");
	});

	test("4. cross-repo origin entry falls through to convention probe (probe hits)", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r9-"));

		const otherRepo = await createTestRepo(
			tempDir,
			"other",
			[{ path: "skills/irrelevant", name: "irrelevant" }],
			"v1.0.0",
		);

		// Origin's manifest redirects `foo` elsewhere — consumer pulls from origin
		// (not the redirect target), and `foo` lives at the conventional path in origin.
		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  foo:",
			`    repo: file://${otherRepo}`,
			"    path: skills/irrelevant",
			`    version: "*"`,
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/foo", name: "foo" }],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			dependencies: {
				foo: { repo: `file://${originRepo}`, version: "*" },
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		const foo = result.entities.get("skill:foo");
		expect(foo?.path).toBe("skills/foo");
		expect(foo?.repo).toBe(`file://${originRepo}`);
	});

	test("5. cross-repo origin entry + no convention hit → R9 error", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r9-"));

		const otherRepo = await createTestRepo(
			tempDir,
			"other",
			[{ path: "skills/irrelevant", name: "irrelevant" }],
			"v1.0.0",
		);

		// Origin redirects `foo` elsewhere; `foo` is NOT at any conventional origin path.
		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  foo:",
			`    repo: file://${otherRepo}`,
			"    path: skills/irrelevant",
			`    version: "*"`,
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/unrelated/sitting-here", name: "unrelated" }],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			dependencies: {
				foo: { repo: `file://${originRepo}`, version: "*" },
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors.length).toBeGreaterThan(0);
		const err = result.errors.join("\n");
		expect(err).toContain("foo");
		expect(err).toContain("has no path");
	});

	test("6. origin's absolute local: path is skipped, convention probe runs", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r9-"));

		const originManifestYaml = [
			"name: origin",
			"sources:",
			"  mine: /does/not/exist",
			"dependencies:",
			"  foo:",
			"    source: mine",
			"    path: skills/foo",
			"",
		].join("\n");

		// Origin also ships foo at the conventional path so fall-through resolves.
		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/foo", name: "foo" }],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			dependencies: {
				foo: { repo: `file://${originRepo}`, version: "*" },
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:foo")?.path).toBe("skills/foo");
	});

	test("7. origin doesn't declare name, convention probe hits", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r9-"));

		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  something-else:",
			"    local: ./skills/something-else",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/something-else", name: "something-else" },
				{ path: "skills/foo", name: "foo" },
			],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			dependencies: {
				foo: { repo: `file://${originRepo}`, version: "*" },
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:foo")?.path).toBe("skills/foo");
	});

	test("8. origin doesn't declare name, convention probe misses → R9 error", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r9-"));

		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  something-else:",
			"    local: ./skills/something-else",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/something-else", name: "something-else" }],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			dependencies: {
				foo: { repo: `file://${originRepo}`, version: "*" },
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors.length).toBeGreaterThan(0);
		const err = result.errors.join("\n");
		expect(err).toContain("foo");
		expect(err).toContain("has no path");
	});

	test("9. origin has no skilltree.yaml → convention probe works", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r9-"));

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/foo", name: "foo" }],
			"v1.0.0",
		);

		const consumerManifest: Manifest = {
			dependencies: {
				foo: { repo: `file://${originRepo}`, version: "*" },
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:foo")?.path).toBe("skills/foo");
	});

	test("10. origin's skilltree.yaml is malformed → convention probe", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r9-"));

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/foo", name: "foo" }],
			"v1.0.0",
			"not: valid: yaml: [unclosed",
		);

		const consumerManifest: Manifest = {
			dependencies: {
				foo: { repo: `file://${originRepo}`, version: "*" },
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:foo")?.path).toBe("skills/foo");
	});

	test("11. origin declares name only in dev-dependencies → not exposed", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r9-"));

		const originManifestYaml = [
			"name: origin",
			"dependencies: {}",
			"dev-dependencies:",
			"  foo:",
			"    local: ./skills/source/foo",
			"",
		].join("\n");

		// Origin has foo in a non-conventional place; dev-dep not exposed; probe can't find it.
		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/source/foo", name: "foo" }],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			dependencies: {
				foo: { repo: `file://${originRepo}`, version: "*" },
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors.length).toBeGreaterThan(0);
		const err = result.errors.join("\n");
		expect(err).toContain("foo");
		expect(err).toContain("has no path");
	});

	test("12. aliased YAML key with name: — lookup uses actual name", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r9-"));

		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  actual-foo:",
			"    local: ./skills/source/actual-foo",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/source/actual-foo", name: "actual-foo" }],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			dependencies: {
				"foo-key": {
					repo: `file://${originRepo}`,
					version: "*",
					name: "actual-foo",
				},
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:actual-foo")?.path).toBe("skills/source/actual-foo");
	});

	test("13. agent direct dep with no path, origin declares agent", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r9-"));

		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  my-agent:",
			"    local: ./agents/source/my-agent.md",
			"    type: agent",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "agents/source/my-agent.md", name: "my-agent", isAgent: true }],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			dependencies: {
				"my-agent": { repo: `file://${originRepo}`, version: "*", type: "agent" },
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		const agent = result.entities.get("agent:my-agent");
		expect(agent).toBeDefined();
		expect(agent?.path).toBe("agents/source/my-agent.md");
	});
});

describe("R12 manifest validation (path optional on remote deps)", () => {
	test("V1. validateManifest: remote dep without path: is valid", () => {
		const manifest: Manifest = {
			dependencies: {
				foo: { repo: "github.com/org/r", version: "*" },
			},
		};
		expect(validateManifest(manifest)).toEqual([]);
	});

	test("V2. validateManifest: mutually exclusive repo + local still errors", () => {
		const manifest: Manifest = {
			dependencies: {
				foo: { repo: "github.com/org/r", local: "./x" } as unknown as Dependency,
			},
		};
		const errors = validateManifest(manifest);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.join("\n")).toContain("mutually exclusive");
	});

	test("V3. parseManifest round-trips force_path: true", () => {
		const yaml = [
			"dependencies:",
			"  foo:",
			"    repo: github.com/org/r",
			"    path: x/y",
			"    force_path: true",
			"",
		].join("\n");

		const m = parseManifest(yaml);
		const dep = (m.dependencies?.foo ?? {}) as { force_path?: boolean };
		expect(dep.force_path).toBe(true);

		const re = serializeManifest(m);
		expect(re).toContain("force_path: true");
	});
});
