import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAll } from "../../src/core/graph.js";
import type { Manifest } from "../../src/types.js";
import { createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("origin-manifest transitive resolution", () => {
	test("resolves transitive dep declared as local: in origin manifest", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		// Origin repo: parent skill references `child`, child lives at
		// skills/source/child (not the conventional skills/child),
		// origin's skilltree.yaml declares child as local: ./skills/source/child.
		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  child:",
			"    local: ./skills/source/child",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/source/parent", name: "parent", dependencies: ["child"] },
				{ path: "skills/source/child", name: "child" },
			],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			dependencies: {
				parent: {
					repo: `file://${originRepo}`,
					path: "skills/source/parent",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);

		const child = result.entities.get("skill:child");
		expect(child).toBeDefined();
		expect(child?.repo).toBe(`file://${originRepo}`);
		expect(child?.path).toBe("skills/source/child");
		expect(child?.tag).toBe("v1.0.0");
		expect(child?.local).toBe(false);
	});

	test("falls through to conventional probe when origin has no skilltree.yaml", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/parent", name: "parent", dependencies: ["child"] },
				{ path: "skills/child", name: "child" },
			],
			"v1.0.0",
			// No manifestYaml — origin has no skilltree.yaml
		);

		const consumerManifest: Manifest = {
			dependencies: {
				parent: {
					repo: `file://${originRepo}`,
					path: "skills/parent",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		const child = result.entities.get("skill:child");
		expect(child).toBeDefined();
		expect(child?.path).toBe("skills/child");
	});

	test("falls through to conventional probe when origin skilltree.yaml doesn't declare the name", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  unrelated:",
			"    local: ./skills/unrelated",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/parent", name: "parent", dependencies: ["child"] },
				{ path: "skills/child", name: "child" },
				{ path: "skills/unrelated", name: "unrelated" },
			],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			dependencies: {
				parent: {
					repo: `file://${originRepo}`,
					path: "skills/parent",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		const child = result.entities.get("skill:child");
		expect(child).toBeDefined();
		expect(child?.path).toBe("skills/child");
	});

	test("does not expose origin dev-dependencies; error hints at the reason", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		// Origin declares `child` only as a dev-dependency.
		const originManifestYaml = [
			"name: origin",
			"dependencies: {}",
			"dev-dependencies:",
			"  child:",
			"    local: ./skills/source/child",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/source/parent", name: "parent", dependencies: ["child"] },
				{ path: "skills/source/child", name: "child" },
			],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			dependencies: {
				parent: {
					repo: `file://${originRepo}`,
					path: "skills/source/parent",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors.length).toBe(1);
		const err = result.errors[0];
		expect(err).toContain('declares dependency "child"');
		expect(err).toContain("dev-dependency in origin");
		expect(err).toContain("not exposed to downstream consumers");
	});

	test("malformed origin skilltree.yaml falls through silently", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/parent", name: "parent", dependencies: ["child"] },
				{ path: "skills/child", name: "child" },
			],
			"v1.0.0",
			"not: valid: yaml: [unclosed",
		);

		const consumerManifest: Manifest = {
			dependencies: {
				parent: {
					repo: `file://${originRepo}`,
					path: "skills/parent",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		const child = result.entities.get("skill:child");
		expect(child).toBeDefined();
		expect(child?.path).toBe("skills/child");
	});
});
