import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAll } from "../../src/core/graph.js";
import type { Dependency, Manifest } from "../../src/types.js";
import { createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function setupOriginWithLocal(): Promise<{ originRepo: string; manifestYaml: string }> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-r10-"));
	const manifestYaml = [
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
		manifestYaml,
	);
	return { originRepo, manifestYaml };
}

describe("R10 origin-manifest path warnings", () => {
	test("1. consumer path matches origin's local: → redundant warning", async () => {
		const { originRepo } = await setupOriginWithLocal();
		const consumerManifest: Manifest = {
			dependencies: {
				foo: {
					repo: `file://${originRepo}`,
					path: "skills/source/foo",
					version: "*",
				},
			},
		};
		const result = await resolveAll(consumerManifest, tempDir);
		expect(result.errors).toEqual([]);
		const warnings = result.warnings.join("\n");
		expect(warnings).toContain("foo");
		expect(warnings).toContain("same path");
		expect(warnings).toContain("omit");
	});

	test("2. consumer path matches origin's same-repo repo: path → redundant warning", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r10-"));
		const manifestYaml = [
			"name: origin",
			"dependencies:",
			"  foo:",
			`    repo: file://${join(tempDir, "origin")}`,
			"    path: skills/source/foo",
			`    version: "*"`,
			"",
		].join("\n");
		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/source/foo", name: "foo" }],
			"v1.0.0",
			manifestYaml,
		);
		const consumerManifest: Manifest = {
			dependencies: {
				foo: {
					repo: `file://${originRepo}`,
					path: "skills/source/foo",
					version: "*",
				},
			},
		};
		const result = await resolveAll(consumerManifest, tempDir);
		expect(result.errors).toEqual([]);
		expect(result.warnings.join("\n")).toContain("same path");
	});

	test("3. consumer path differs from origin's path → override warning", async () => {
		// Build a repo with two skill locations so consumer's override resolves.
		// Origin's manifest only declares the "main" path; consumer picks the alt.
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r10-"));
		const manifestYaml = [
			"name: origin",
			"dependencies:",
			"  foo:",
			"    local: ./skills/source/foo",
			"",
		].join("\n");
		const repo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/source/foo", name: "foo" },
				{ path: "skills/alt/foo", name: "foo" },
			],
			"v1.0.0",
			manifestYaml,
		);
		const consumerManifest: Manifest = {
			dependencies: {
				foo: {
					repo: `file://${repo}`,
					path: "skills/alt/foo",
					version: "*",
				},
			},
		};
		const result = await resolveAll(consumerManifest, tempDir);
		expect(result.errors).toEqual([]);
		const warnings = result.warnings.join("\n");
		expect(warnings).toContain("foo");
		expect(warnings).toContain("skills/alt/foo");
		expect(warnings).toContain("skills/source/foo");
		expect(warnings).toContain("force_path");
	});

	test("4. origin doesn't declare name → no warning", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r10-"));
		const manifestYaml = [
			"name: origin",
			"dependencies:",
			"  other-thing:",
			"    local: ./skills/other-thing",
			"",
		].join("\n");
		const repo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/other-thing", name: "other-thing" },
				{ path: "skills/foo", name: "foo" },
			],
			"v1.0.0",
			manifestYaml,
		);
		const consumerManifest: Manifest = {
			dependencies: {
				foo: { repo: `file://${repo}`, path: "skills/foo", version: "*" },
			},
		};
		const result = await resolveAll(consumerManifest, tempDir);
		expect(result.errors).toEqual([]);
		const warnings = result.warnings.join("\n");
		expect(warnings).not.toContain("foo");
	});

	test("5. origin declares name only in dev-dependencies → no warning", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r10-"));
		const manifestYaml = [
			"name: origin",
			"dependencies: {}",
			"dev-dependencies:",
			"  foo:",
			"    local: ./skills/source/foo",
			"",
		].join("\n");
		const repo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/source/foo", name: "foo" },
				{ path: "skills/foo", name: "foo" },
			],
			"v1.0.0",
			manifestYaml,
		);
		const consumerManifest: Manifest = {
			dependencies: {
				foo: { repo: `file://${repo}`, path: "skills/foo", version: "*" },
			},
		};
		const result = await resolveAll(consumerManifest, tempDir);
		expect(result.errors).toEqual([]);
		// dev-deps invisible to consumers — no warning about path redundancy
		const warnings = result.warnings.join("\n");
		expect(warnings).not.toContain("same path");
		expect(warnings).not.toContain("overriding");
	});

	test("6. force_path: true with matching path → no warning", async () => {
		const { originRepo } = await setupOriginWithLocal();
		const consumerManifest: Manifest = {
			dependencies: {
				foo: {
					repo: `file://${originRepo}`,
					path: "skills/source/foo",
					version: "*",
					force_path: true,
				},
			},
		};
		const result = await resolveAll(consumerManifest, tempDir);
		expect(result.errors).toEqual([]);
		const warnings = result.warnings.join("\n");
		expect(warnings).not.toContain("foo");
	});

	test("7. force_path: true with differing path → no warning", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r10-"));
		const manifestYaml = [
			"name: origin",
			"dependencies:",
			"  foo:",
			"    local: ./skills/source/foo",
			"",
		].join("\n");
		const repo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/source/foo", name: "foo" },
				{ path: "skills/alt/foo", name: "foo" },
			],
			"v1.0.0",
			manifestYaml,
		);
		const consumerManifest: Manifest = {
			dependencies: {
				foo: {
					repo: `file://${repo}`,
					path: "skills/alt/foo",
					version: "*",
					force_path: true,
				},
			},
		};
		const result = await resolveAll(consumerManifest, tempDir);
		expect(result.errors).toEqual([]);
		const warnings = result.warnings.join("\n");
		expect(warnings).not.toContain("overriding");
	});

	test("8. force_path: true + origin doesn't declare → no warning, no error", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r10-"));
		const manifestYaml = [
			"name: origin",
			"dependencies:",
			"  other-thing:",
			"    local: ./skills/other-thing",
			"",
		].join("\n");
		const repo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/other-thing", name: "other-thing" },
				{ path: "skills/foo", name: "foo" },
			],
			"v1.0.0",
			manifestYaml,
		);
		const consumerManifest: Manifest = {
			dependencies: {
				foo: {
					repo: `file://${repo}`,
					path: "skills/foo",
					version: "*",
					force_path: true,
				},
			},
		};
		const result = await resolveAll(consumerManifest, tempDir);
		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:foo")?.path).toBe("skills/foo");
	});
});

describe("Side-quest: source/path gap coverage", () => {
	test("S2. source: expands to URL, path missing, origin doesn't help → R9 error", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r10-"));
		const manifestYaml = ["name: origin", "dependencies: {}", ""].join("\n");
		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/unrelated", name: "unrelated" }],
			"v1.0.0",
			manifestYaml,
		);

		const consumerManifest: Manifest = {
			sources: { oo: `file://${originRepo}` },
			dependencies: {
				foo: { source: "oo", version: "*" } as Dependency,
			},
		};
		const result = await resolveAll(consumerManifest, tempDir);
		expect(result.errors.length).toBeGreaterThan(0);
		const err = result.errors.join("\n");
		expect(err).toContain("foo");
		expect(err).toContain("no path");
	});
});
