import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { resolveAll } from "../../src/core/graph.js";
import type { Manifest } from "../../src/types.js";
import { createTestRepo } from "../helpers/git-fixtures.js";

async function addSecondTag(repoDir: string, tag: string, markerFile: string): Promise<void> {
	// Make a trivial commit and tag it. Used for tests that need two tags
	// on a non-bare working repo without going through the bare-fetch dance.
	await writeFile(join(repoDir, markerFile), `tagged ${tag}\n`);
	const git = simpleGit(repoDir);
	await git.add(".");
	await git.commit(`Update for ${tag}`);
	await git.addTag(tag);
}

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

	test("cross-repo: origin's source: alias expands to a remote repo", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		const thirdPartyRepo = await createTestRepo(
			tempDir,
			"third-party",
			[{ path: "skills/shared-skill", name: "shared-skill" }],
			"v2.0.0",
		);

		// Origin uses a source alias that expands to the third-party repo URL.
		const originManifestYaml = [
			"name: origin",
			"sources:",
			`  tp: file://${thirdPartyRepo}`,
			"dependencies:",
			"  shared-skill:",
			"    source: tp",
			"    path: skills/shared-skill",
			`    version: "*"`,
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/parent", name: "parent", dependencies: ["shared-skill"] }],
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
		const shared = result.entities.get("skill:shared-skill");
		expect(shared).toBeDefined();
		expect(shared?.repo).toBe(`file://${thirdPartyRepo}`);
		expect(shared?.tag).toBe("v2.0.0");
	});

	test("cross-repo: version constraint from origin pins the tag", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		// Third-party repo with two tags — origin constrains to the older line.
		const thirdPartyRepo = await createTestRepo(
			tempDir,
			"third-party",
			[{ path: "skills/helper", name: "helper" }],
			"v1.0.0",
		);
		// Add a second, incompatible major-version tag.
		await addSecondTag(thirdPartyRepo, "v2.0.0", "v2-marker.txt");

		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  helper:",
			`    repo: file://${thirdPartyRepo}`,
			"    path: skills/helper",
			`    version: "^1.0.0"`,
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
		expect(helper?.tag).toBe("v1.0.0");
	});

	test("cross-repo: reuses an already-resolved repo if origin's constraint is satisfied", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		// Third-party repo has two skills — consumer directly depends on one
		// (which pins the repo's tag), origin transitively references the other.
		const thirdPartyRepo = await createTestRepo(
			tempDir,
			"third-party",
			[
				{ path: "skills/direct", name: "direct" },
				{ path: "skills/transitive", name: "transitive" },
			],
			"v1.0.0",
		);

		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  transitive:",
			`    repo: file://${thirdPartyRepo}`,
			"    path: skills/transitive",
			`    version: "*"`,
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/parent", name: "parent", dependencies: ["transitive"] }],
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
				direct: {
					repo: `file://${thirdPartyRepo}`,
					path: "skills/direct",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		const direct = result.entities.get("skill:direct");
		const transitive = result.entities.get("skill:transitive");
		expect(direct?.tag).toBe("v1.0.0");
		expect(transitive?.tag).toBe("v1.0.0");
		// Same cache path -> same repo resolution was reused, not re-cloned.
		expect(direct?.repo).toBe(transitive?.repo);
	});

	test("cross-repo: constraint conflict with already-resolved repo produces clear error", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		// Third-party repo has both v1.0.0 and v2.0.0.
		const thirdPartyRepo = await createTestRepo(
			tempDir,
			"third-party",
			[
				{ path: "skills/direct", name: "direct" },
				{ path: "skills/transitive", name: "transitive" },
			],
			"v1.0.0",
		);
		await addSecondTag(thirdPartyRepo, "v2.0.0", "v2-marker.txt");

		// Origin declares transitive at ^1.0.0, but the consumer pins the
		// third-party repo to ^2.0.0 via its own `direct` dep. Incompatible.
		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  transitive:",
			`    repo: file://${thirdPartyRepo}`,
			"    path: skills/transitive",
			`    version: "^1.0.0"`,
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/parent", name: "parent", dependencies: ["transitive"] }],
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
				direct: {
					repo: `file://${thirdPartyRepo}`,
					path: "skills/direct",
					version: "^2.0.0",
				},
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors.length).toBeGreaterThan(0);
		const err = result.errors.join("\n");
		expect(err).toContain("Cross-repo transitive constraint conflict");
		expect(err).toContain("2.0.0");
	});

	test("cross-repo: unreachable third-party repo produces a clear error, not a crash", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		const bogusRepo = `file://${join(tempDir, "does-not-exist")}`;
		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  ghost:",
			`    repo: ${bogusRepo}`,
			"    path: skills/ghost",
			`    version: "*"`,
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/parent", name: "parent", dependencies: ["ghost"] }],
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

		expect(result.errors.length).toBeGreaterThan(0);
		const err = result.errors.join("\n");
		expect(err).toContain("Git operation failed");
	});

	test("cross-repo: consumer pre-declaration wins (tier 2 beats tier 4)", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		const thirdPartyRepo = await createTestRepo(
			tempDir,
			"third-party",
			[
				{ path: "skills/helper", name: "helper" },
				{ path: "different/path/helper-v2", name: "helper" },
			],
			"v1.0.0",
		);

		// Origin points helper at skills/helper.
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

		// Consumer overrides path — their declaration must win over origin's.
		const consumerManifest: Manifest = {
			dependencies: {
				parent: {
					repo: `file://${originRepo}`,
					path: "skills/parent",
					version: "*",
				},
				helper: {
					repo: `file://${thirdPartyRepo}`,
					path: "different/path/helper-v2",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		const helper = result.entities.get("skill:helper");
		expect(helper?.path).toBe("different/path/helper-v2");
	});

	test("cross-repo: absolute local: path from source→local expansion is skipped silently", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		// Origin's manifest has a source alias that points at an absolute
		// filesystem path (e.g., origin author's machine). After expansion this
		// becomes a LocalDep with an absolute `local:` path, which consumers
		// cannot use — resolver must skip and fall through to the convention probe.
		const originManifestYaml = [
			"name: origin",
			"sources:",
			"  mine: /does/not/exist/on/consumer",
			"dependencies:",
			"  child:",
			"    source: mine",
			"    path: skills/child",
			"",
		].join("\n");

		// Origin also ships the skill at the conventional path so the fall-through works.
		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/parent", name: "parent", dependencies: ["child"] },
				{ path: "skills/child", name: "child" },
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
		// Resolved via the conventional probe, not the absolute local: path.
		expect(child?.path).toBe("skills/child");
	});

	test("cross-repo: multi-level chain resolves recursively", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		// Third-party repo's skill itself declares a frontmatter dep,
		// and the third-party's skilltree.yaml says where to find it
		// (another skill in the same third-party repo at a nested path).
		const thirdPartyManifestYaml = [
			"name: third-party",
			"dependencies:",
			"  grandchild:",
			"    local: ./skills/source/grandchild",
			"",
		].join("\n");

		const thirdPartyRepo = await createTestRepo(
			tempDir,
			"third-party",
			[
				{ path: "skills/helper", name: "helper", dependencies: ["grandchild"] },
				{ path: "skills/source/grandchild", name: "grandchild" },
			],
			"v1.0.0",
			thirdPartyManifestYaml,
		);

		// Origin's manifest cross-references third-party for `helper`.
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
		const parent = result.entities.get("skill:parent");
		const helper = result.entities.get("skill:helper");
		const grandchild = result.entities.get("skill:grandchild");

		expect(parent).toBeDefined();
		expect(helper).toBeDefined();
		expect(grandchild).toBeDefined();

		// grandchild came from third-party repo via third-party's manifest
		expect(grandchild?.repo).toBe(`file://${thirdPartyRepo}`);
		expect(grandchild?.path).toBe("skills/source/grandchild");
	});
});
