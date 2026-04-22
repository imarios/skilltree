import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
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

	test("N1. path normalization: trailing slash still counts as redundant", async () => {
		const { originRepo } = await setupOriginWithLocal();
		const consumerManifest: Manifest = {
			dependencies: {
				foo: {
					repo: `file://${originRepo}`,
					path: "skills/source/foo/", // trailing slash
					version: "*",
				},
			},
		};
		const result = await resolveAll(consumerManifest, tempDir);
		expect(result.errors).toEqual([]);
		const warnings = result.warnings.join("\n");
		expect(warnings).toContain("same path");
		expect(warnings).not.toContain("overriding");
	});

	test("E1. explicit empty path errors clearly instead of silently inferring", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-r10-"));
		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  foo:",
			"    local: ./skills/source/foo",
			"",
		].join("\n");
		const repo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/source/foo", name: "foo" }],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			dependencies: {
				foo: { repo: `file://${repo}`, path: "", version: "*" },
			},
		};
		const result = await resolveAll(consumerManifest, tempDir);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors.join("\n")).toContain("empty `path:`");
		// And we didn't quietly resolve the entity.
		expect(result.entities.get("skill:foo")).toBeUndefined();
	});

	test("F1. force_path as a string (not a boolean) does NOT silence the warning", async () => {
		const { originRepo } = await setupOriginWithLocal();
		const consumerManifest: Manifest = {
			dependencies: {
				foo: {
					repo: `file://${originRepo}`,
					path: "skills/source/foo",
					version: "*",
					// Simulates a user who wrote `force_path: "true"` (quoted/stringy).
					// Must NOT be treated as the boolean opt-out.
					force_path: "true" as unknown as boolean,
				},
			},
		};
		const result = await resolveAll(consumerManifest, tempDir);
		expect(result.errors).toEqual([]);
		expect(result.warnings.join("\n")).toContain("same path");
	});

	test("N4. path normalization: repeated ./ prefix matches plain origin path", async () => {
		const { originRepo } = await setupOriginWithLocal();
		const consumerManifest: Manifest = {
			dependencies: {
				foo: {
					repo: `file://${originRepo}`,
					path: "././skills/source/foo", // repeated ./
					version: "*",
				},
			},
		};
		const result = await resolveAll(consumerManifest, tempDir);
		const warnings = result.warnings.join("\n");
		expect(warnings).not.toContain("overriding");
	});

	test("N3. path normalization: leading / on consumer side matches plain origin path", async () => {
		const { originRepo } = await setupOriginWithLocal();
		const consumerManifest: Manifest = {
			dependencies: {
				foo: {
					repo: `file://${originRepo}`,
					path: "/skills/source/foo", // leading slash — treat as tree-root relative
					version: "*",
				},
			},
		};
		const result = await resolveAll(consumerManifest, tempDir);
		// Resolution itself may fail (git won't accept /-prefixed paths),
		// but the warning comparison must not spuriously flag an override.
		const warnings = result.warnings.join("\n");
		expect(warnings).not.toContain("overriding");
	});

	test("N2. path normalization: ./ prefix on consumer side matches plain origin path", async () => {
		const { originRepo } = await setupOriginWithLocal();
		const consumerManifest: Manifest = {
			dependencies: {
				foo: {
					repo: `file://${originRepo}`,
					path: "./skills/source/foo",
					version: "*",
				},
			},
		};
		const result = await resolveAll(consumerManifest, tempDir);
		expect(result.errors).toEqual([]);
		expect(result.warnings.join("\n")).toContain("same path");
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

/**
 * Build an origin repo where:
 *  - Tag v1.0.0 points at a commit that contains the skill but NO skilltree.yaml
 *  - The default branch has a later commit that adds skilltree.yaml
 *
 * Simulates the open-vibes situation: author committed a skilltree.yaml to
 * main but never cut a new tag, so consumers on version: "*" resolve to a
 * tag that predates the manifest.
 */
async function setupStaleTagOrigin(baseDir: string): Promise<string> {
	const repoDir = join(baseDir, "origin");
	await mkdir(repoDir, { recursive: true });

	const git = simpleGit(repoDir);
	await git.init();
	await git.addConfig("user.email", "test@test.com");
	await git.addConfig("user.name", "Test");
	// Force main so the default-branch probe is deterministic on systems where
	// git init picks master.
	await git.raw(["symbolic-ref", "HEAD", "refs/heads/main"]);

	const skillDir = join(repoDir, "skills/source/foo");
	await mkdir(skillDir, { recursive: true });
	await writeFile(join(skillDir, "SKILL.md"), "---\nname: foo\n---\n\n# foo\n");
	await git.add(".");
	await git.commit("Initial commit");
	await git.addTag("v1.0.0");

	// Now add skilltree.yaml on main — no new tag.
	await writeFile(
		join(repoDir, "skilltree.yaml"),
		["name: origin", "dependencies:", "  foo:", "    local: ./skills/source/foo", ""].join("\n"),
	);
	await git.add(".");
	await git.commit("Add skilltree.yaml on main");

	return repoDir;
}

describe("stale-tag origin manifest warning", () => {
	test("warns when skilltree.yaml exists on default branch but not at resolved tag", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-stale-tag-"));
		const originRepo = await setupStaleTagOrigin(tempDir);

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
		// Warning must name the repo and hint that authoring on main isn't
		// reaching consumers because the tag is stale.
		expect(warnings).toContain(originRepo);
		expect(warnings).toMatch(/stale tag|not at tag|cut a new tag|missing at/i);
	});

	test("warns once per repo even with multiple consumer entries", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-stale-tag-"));
		const originRepo = await setupStaleTagOrigin(tempDir);

		// Add a second skill to the same repo without cutting a new tag;
		// main still has the manifest, tag still doesn't.
		const skillDir = join(originRepo, "skills/source/bar");
		await mkdir(skillDir, { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), "---\nname: bar\n---\n\n# bar\n");
		const git = simpleGit(originRepo);
		await git.add(".");
		await git.commit("add bar on main");

		// But tag v1.0.0 stays where it was — neither skilltree.yaml nor bar
		// are reachable at the tag. Consumer can only depend on foo at the tag.
		const consumerManifest: Manifest = {
			dependencies: {
				foo: {
					repo: `file://${originRepo}`,
					path: "skills/source/foo",
					version: "*",
				},
				"foo-again": {
					repo: `file://${originRepo}`,
					path: "skills/source/foo",
					version: "*",
					name: "foo",
				} as Dependency,
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);
		// The stale-tag warning should appear exactly once despite two entries
		// pointing at the same repo.
		const staleWarnings = result.warnings.filter((w) =>
			/stale tag|not at tag|cut a new tag|missing at/i.test(w),
		);
		expect(staleWarnings.length).toBe(1);
	});

	test("stays silent when origin has no skilltree.yaml anywhere", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-stale-tag-"));
		// No skilltree.yaml ever — not on main, not at the tag.
		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "skills/source/foo", name: "foo" }],
			"v1.0.0",
			// manifestYaml intentionally omitted
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
		const staleWarnings = result.warnings.filter((w) =>
			/stale tag|not at tag|cut a new tag|missing at/i.test(w),
		);
		expect(staleWarnings).toEqual([]);
	});

	test("stays silent when the manifest is present at the resolved tag", async () => {
		// Standard case — origin tagged its manifest. No staleness.
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-stale-tag-"));
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
		const staleWarnings = result.warnings.filter((w) =>
			/stale tag|not at tag|cut a new tag|missing at/i.test(w),
		);
		expect(staleWarnings).toEqual([]);
	});
});
