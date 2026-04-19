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

	test("nested source-layout: multi-level transitive chain through unconventional layout", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		// Origin layout nests skills under skills/source/<name> instead of skills/<name>.
		// task-builder depends on hypothesis-building-task AND task-naming.
		// Origin's manifest declares both as local:.
		const originManifestYaml = [
			"name: nested-source-layout",
			"dependencies:",
			"  task-builder:",
			"    local: ./skills/source/task-builder",
			"  hypothesis-building-task:",
			"    local: ./skills/source/hypothesis-building-task",
			"  task-naming:",
			"    local: ./skills/source/task-naming",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"nested-source-layout",
			[
				{
					path: "skills/source/task-builder",
					name: "task-builder",
					dependencies: ["hypothesis-building-task", "task-naming"],
				},
				{
					path: "skills/source/hypothesis-building-task",
					name: "hypothesis-building-task",
				},
				{ path: "skills/source/task-naming", name: "task-naming" },
			],
			"v2.0.0",
			originManifestYaml,
		);

		// Consumer only declares task-builder; transitive deps should auto-resolve.
		const consumerManifest: Manifest = {
			dependencies: {
				"task-builder": {
					repo: `file://${originRepo}`,
					path: "skills/source/task-builder",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);

		const taskBuilder = result.entities.get("skill:task-builder");
		const hyp = result.entities.get("skill:hypothesis-building-task");
		const naming = result.entities.get("skill:task-naming");

		expect(taskBuilder).toBeDefined();
		expect(hyp).toBeDefined();
		expect(naming).toBeDefined();

		// All three share the origin repo and tag.
		expect(taskBuilder?.tag).toBe("v2.0.0");
		expect(hyp?.tag).toBe("v2.0.0");
		expect(naming?.tag).toBe("v2.0.0");

		// Transitive deps point at the unconventional paths from origin's manifest.
		expect(hyp?.path).toBe("skills/source/hypothesis-building-task");
		expect(naming?.path).toBe("skills/source/task-naming");
	});

	test("cross-repo: origin manifest's repo: entry resolves against a third-party repo", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		// Third-party repo: ships the transitively-needed skill at a conventional path.
		const thirdPartyRepo = await createTestRepo(
			tempDir,
			"third-party",
			[{ path: "skills/helper", name: "helper" }],
			"v1.2.0",
		);

		// Origin repo: parent references `helper`; origin's manifest declares
		// helper as a remote dep in the third-party repo.
		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  helper:",
			`    repo: file://${thirdPartyRepo}`,
			"    path: skills/helper",
			`    version: "*"`,
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/parent", name: "parent", dependencies: ["helper"] }],
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

		const helper = result.entities.get("skill:helper");
		expect(helper).toBeDefined();
		expect(helper?.repo).toBe(`file://${thirdPartyRepo}`);
		expect(helper?.path).toBe("skills/helper");
		expect(helper?.tag).toBe("v1.2.0");
		expect(helper?.local).toBe(false);
	});
});
