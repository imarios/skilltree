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

// =============================================================================
// Group H — Local pack expansion (happy path)
// =============================================================================

describe("packs — local pack expansion", () => {
	test("H1 — local pack with 3 remote members expands to 3 entities", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-packs-h1-"));
		const origin = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "foo", name: "foo" },
				{ path: "bar", name: "bar" },
				{ path: "baz", name: "baz" },
			],
			"v1.0.0",
		);

		const manifest: Manifest = {
			packs: {
				"python-pack": [
					{ repo: `file://${origin}`, path: "foo", version: "*" },
					{ repo: `file://${origin}`, path: "bar", version: "*" },
					{ repo: `file://${origin}`, path: "baz", version: "*" },
				],
			},
			dependencies: {
				"python-pack": { pack: "python-pack" },
			},
		};

		const result = await resolveAll(manifest, tempDir);
		expect(result.errors).toEqual([]);
		expect(result.entities.size).toBe(3);
		expect(result.entities.has("skill:foo")).toBe(true);
		expect(result.entities.has("skill:bar")).toBe(true);
		expect(result.entities.has("skill:baz")).toBe(true);
		// Pack itself is never an entity
		expect(result.entities.has("skill:python-pack")).toBe(false);
		expect(result.entities.has("pack:python-pack")).toBe(false);
	});

	test("H2 — local pack with mixed local + remote members", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-packs-h2-"));
		const origin = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "remote-skill", name: "remote-skill" }],
			"v1.0.0",
		);
		// Local skill in the project itself
		const projectDir = join(tempDir, "project");
		await createTestRepo(tempDir, "project", [{ path: "local-skill", name: "local-skill" }]);

		const manifest: Manifest = {
			packs: {
				mixed: [
					{ repo: `file://${origin}`, path: "remote-skill", version: "*" },
					{ local: "./local-skill" },
				],
			},
			dependencies: { mixed: { pack: "mixed" } },
		};

		const result = await resolveAll(manifest, projectDir);
		expect(result.errors).toEqual([]);
		const remote = result.entities.get("skill:remote-skill");
		const local = result.entities.get("skill:local-skill");
		expect(remote).toBeDefined();
		expect(local).toBeDefined();
		expect(local?.local).toBe(true);
		expect(remote?.local).toBe(false);
		expect(remote?.viaPack).toBe("mixed");
		expect(local?.viaPack).toBe("mixed");
	});

	test("H3 — member with name alias registers under alias", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-packs-h3-"));
		const origin = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "foo", name: "foo" }],
			"v1.0.0",
		);

		const manifest: Manifest = {
			packs: {
				p: [{ repo: `file://${origin}`, path: "foo", name: "foo-renamed", version: "*" }],
			},
			dependencies: { p: { pack: "p" } },
		};

		const result = await resolveAll(manifest, tempDir);
		expect(result.errors).toEqual([]);
		expect(result.entities.has("skill:foo-renamed")).toBe(true);
		expect(result.entities.has("skill:foo")).toBe(false);
	});

	test("H4 — pack ref in dev-dependencies puts members in dev group", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-packs-h4-"));
		const origin = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "foo", name: "foo" }],
			"v1.0.0",
		);

		const manifest: Manifest = {
			packs: { p: [{ repo: `file://${origin}`, path: "foo", version: "*" }] },
			"dev-dependencies": { p: { pack: "p" } },
		};

		const result = await resolveAll(manifest, tempDir);
		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:foo")?.group).toBe("dev");
	});

	test("H6 — declaredIn for local pack member is `consumer`", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-packs-h6-"));
		const origin = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "foo", name: "foo" }],
			"v1.0.0",
		);

		const manifest: Manifest = {
			packs: { p: [{ repo: `file://${origin}`, path: "foo", version: "*" }] },
			dependencies: { p: { pack: "p" } },
		};

		const result = await resolveAll(manifest, tempDir);
		const e = result.entities.get("skill:foo");
		expect(e?.declaredIn?.kind).toBe("consumer");
	});
});

// =============================================================================
// Group I — Local pack — error paths
// =============================================================================

describe("packs — local pack errors", () => {
	test("I1 — pack referenced but undefined", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-packs-i1-"));
		const manifest: Manifest = {
			dependencies: { "missing-pack": { pack: "missing-pack" } },
		};

		const result = await resolveAll(manifest, tempDir);
		expect(result.errors.some((e) => /Pack "missing-pack"/.test(e) && /not defined/.test(e))).toBe(
			true,
		);
	});

	test("I2 — member collides with consumer-declared dep", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-packs-i2-"));
		const origin = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "foo", name: "foo" }],
			"v1.0.0",
		);

		const manifest: Manifest = {
			packs: { p: [{ repo: `file://${origin}`, path: "foo", version: "*" }] },
			dependencies: {
				foo: { repo: `file://${origin}`, path: "foo", version: "*" },
				p: { pack: "p" },
			},
		};

		const result = await resolveAll(manifest, tempDir);
		expect(
			result.errors.some((e) => /collides/.test(e) && /"foo"/.test(e) && /\bp\b/.test(e)),
		).toBe(true);
	});

	test("I3 — two packs sharing a member collide", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-packs-i3-"));
		const origin = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "foo", name: "foo" }],
			"v1.0.0",
		);

		const manifest: Manifest = {
			packs: {
				"pack-a": [{ repo: `file://${origin}`, path: "foo", version: "*" }],
				"pack-b": [{ repo: `file://${origin}`, path: "foo", version: "*" }],
			},
			dependencies: {
				"pack-a": { pack: "pack-a" },
				"pack-b": { pack: "pack-b" },
			},
		};

		const result = await resolveAll(manifest, tempDir);
		expect(result.errors.some((e) => /collides/.test(e))).toBe(true);
	});

	test("I4 — unreferenced local pack → non-blocking warning", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-packs-i4-"));
		const origin = await createTestRepo(
			tempDir,
			"origin",
			[{ path: "foo", name: "foo" }],
			"v1.0.0",
		);

		const manifest: Manifest = {
			packs: { unused: [{ repo: `file://${origin}`, path: "foo", version: "*" }] },
		};

		const result = await resolveAll(manifest, tempDir);
		expect(result.errors).toEqual([]);
		expect(result.warnings.some((w) => /"unused"/.test(w) && /never referenced/.test(w))).toBe(
			true,
		);
	});
});

// =============================================================================
// Group J — Remote pack expansion
// =============================================================================

describe("packs — remote pack expansion", () => {
	test("J1 — remote pack with members in the same containing repo", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-packs-j1-"));

		// Origin repo contains BOTH the packs: definition AND the member skills.
		const originManifestYaml = [
			"name: origin",
			"packs:",
			"  python-pack:",
			"    - repo: file://__SELF__",
			"      path: foo",
			"      version: '*'",
			"    - repo: file://__SELF__",
			"      path: bar",
			"      version: '*'",
		].join("\n");
		const originPath = join(tempDir, "origin");
		await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "foo", name: "foo" },
				{ path: "bar", name: "bar" },
			],
			"v1.0.0",
			originManifestYaml.replace(/__SELF__/g, originPath),
		);
		// Re-tag after manifest write (createTestRepo already commits + tags before the manifest is fully wired —
		// but createTestRepo writes manifestYaml in the same commit. Verify by re-reading the tag.)

		const manifest: Manifest = {
			dependencies: {
				"python-pack": {
					pack: "python-pack",
					repo: `file://${originPath}`,
					version: "*",
				},
			},
		};

		const result = await resolveAll(manifest, tempDir);
		expect(result.errors).toEqual([]);
		expect(result.entities.has("skill:foo")).toBe(true);
		expect(result.entities.has("skill:bar")).toBe(true);
		const e = result.entities.get("skill:foo");
		expect(e?.declaredIn?.kind).toBe("transitive");
	});

	test("J2 — remote pack: members in a DIFFERENT repo", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-packs-j2-"));

		// Repo B holds the actual skills.
		const repoB = await createTestRepo(
			tempDir,
			"repo-b",
			[
				{ path: "foo", name: "foo" },
				{ path: "bar", name: "bar" },
			],
			"v1.0.0",
		);

		// Repo A defines the pack, members point at repo B.
		const repoAManifest = [
			"name: pack-host",
			"packs:",
			"  python-pack:",
			`    - repo: file://${repoB}`,
			"      path: foo",
			"      version: '*'",
			`    - repo: file://${repoB}`,
			"      path: bar",
			"      version: '*'",
		].join("\n");
		const repoA = await createTestRepo(tempDir, "repo-a", [], "v1.0.0", repoAManifest);

		const manifest: Manifest = {
			dependencies: {
				"python-pack": {
					pack: "python-pack",
					repo: `file://${repoA}`,
					version: "*",
				},
			},
		};

		const result = await resolveAll(manifest, tempDir);
		expect(result.errors).toEqual([]);
		expect(result.entities.has("skill:foo")).toBe(true);
		expect(result.entities.has("skill:bar")).toBe(true);
	});
});

// =============================================================================
// Group K — Remote pack errors
// =============================================================================

describe("packs — remote pack errors", () => {
	test("K1 — remote manifest has no packs: section", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-packs-k1-"));
		// Origin has a manifest but no packs: section.
		const originManifest = "name: origin\ndependencies: {}\n";
		const origin = await createTestRepo(tempDir, "origin", [], "v1.0.0", originManifest);

		const manifest: Manifest = {
			dependencies: {
				"python-pack": {
					pack: "python-pack",
					repo: `file://${origin}`,
					version: "*",
				},
			},
		};

		const result = await resolveAll(manifest, tempDir);
		expect(result.errors.some((e) => /Pack "python-pack"/.test(e) && /not found/.test(e))).toBe(
			true,
		);
	});

	test("K2 — remote manifest has packs: but missing the named pack", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-packs-k2-"));
		const originManifest = [
			"name: origin",
			"packs:",
			"  other-pack:",
			"    - repo: file:///nowhere",
			"      path: x",
		].join("\n");
		const origin = await createTestRepo(tempDir, "origin", [], "v1.0.0", originManifest);

		const manifest: Manifest = {
			dependencies: {
				"python-pack": {
					pack: "python-pack",
					repo: `file://${origin}`,
					version: "*",
				},
			},
		};

		const result = await resolveAll(manifest, tempDir);
		expect(result.errors.some((e) => /Pack "python-pack"/.test(e) && /not found/.test(e))).toBe(
			true,
		);
	});

	test("K3 — remote pack member with absolute local path → reject", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-packs-k3-"));
		const originManifest = [
			"name: origin",
			"packs:",
			"  bad-pack:",
			"    - local: /abs/path/that/cannot/work",
		].join("\n");
		const origin = await createTestRepo(tempDir, "origin", [], "v1.0.0", originManifest);

		const manifest: Manifest = {
			dependencies: {
				"bad-pack": {
					pack: "bad-pack",
					repo: `file://${origin}`,
					version: "*",
				},
			},
		};

		const result = await resolveAll(manifest, tempDir);
		expect(result.errors.some((e) => /bad-pack/.test(e) && /absolute local path/i.test(e))).toBe(
			true,
		);
	});
});
