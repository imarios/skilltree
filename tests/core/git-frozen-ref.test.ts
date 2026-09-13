/**
 * Neon Phase 1 (#203): a frozen dep's commit survives upstream deleting or
 * moving its tag.
 *
 * The cache's tag fetch runs with `--prune`, so without a preserved ref the
 * frozen tag would vanish from the cache the moment upstream removed it —
 * which is the situation freezing exists for.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { FROZEN_REF_PREFIX, readRef, repoCachePath, writeRef } from "../../src/core/git.js";
import { resolveAll } from "../../src/core/graph.js";
import type { Manifest } from "../../src/types.js";
import { addTagToRepo, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string | undefined;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
	tempDir = undefined;
});

interface Fixture {
	dir: string;
	bareDir: string;
	repo: string;
	oldCommit: string;
	newCommit: string;
}

async function buildFixture(): Promise<Fixture> {
	const dir = await mkdtemp(join(tmpdir(), "skilltree-frozen-ref-"));
	tempDir = dir;
	const repoDir = await createTestRepo(
		dir,
		"upstream",
		[{ path: "skills/stable", name: "stable" }],
		"v0.4.0",
	);
	const bareDir = join(dir, "upstream.git");
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	await addTagToRepo(repoDir, bareDir, "v0.6.0", [{ path: "skills/stable", name: "stable" }]);
	const bare = simpleGit(bareDir);
	return {
		dir,
		bareDir,
		repo: `file://${bareDir}`,
		oldCommit: (await bare.revparse(["v0.4.0^{commit}"])).trim(),
		newCommit: (await bare.revparse(["v0.6.0^{commit}"])).trim(),
	};
}

function frozenManifest(repo: string): Manifest {
	return {
		dependencies: {
			stable: { repo, path: "skills/stable", type: "skill", frozen: "0.4.0" },
		},
	};
}

describe("preserved commit for frozen deps (#203)", () => {
	test("PR1 resolving a frozen dep records its commit under refs/skilltree/frozen/", async () => {
		const fx = await buildFixture();

		const result = await resolveAll(frozenManifest(fx.repo), fx.dir);

		expect(result.errors).toEqual([]);
		expect(await readRef(repoCachePath(fx.repo), `${FROZEN_REF_PREFIX}0.4.0`)).toBe(fx.oldCommit);
	});

	test("PR2 tag deleted upstream → the preserved commit is used, with a warning", async () => {
		const fx = await buildFixture();
		await resolveAll(frozenManifest(fx.repo), fx.dir);
		await simpleGit(fx.bareDir).raw(["tag", "-d", "v0.4.0"]);

		const result = await resolveAll(frozenManifest(fx.repo), fx.dir);

		expect(result.errors).toEqual([]);
		const entity = result.entities.get("skill:stable");
		expect(entity?.commit).toBe(fx.oldCommit);
		expect(entity?.version).toBe("0.4.0");
		expect(entity?.tag).toBeUndefined();
		const warning = result.warnings.find((w) => w.includes("no longer has that tag"));
		expect(warning).toContain(fx.oldCommit.slice(0, 7));
	});

	test("PR3 tag moved upstream → the preserved commit is kept, warning names both and the fix", async () => {
		const fx = await buildFixture();
		await resolveAll(frozenManifest(fx.repo), fx.dir);
		await simpleGit(fx.bareDir).raw(["tag", "-f", "v0.4.0", fx.newCommit]);

		const result = await resolveAll(frozenManifest(fx.repo), fx.dir);

		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:stable")?.commit).toBe(fx.oldCommit);
		const warning = result.warnings.find((w) => w.includes("was moved upstream"));
		expect(warning).toContain(fx.oldCommit.slice(0, 7));
		expect(warning).toContain(fx.newCommit.slice(0, 7));
		expect(warning).toContain("skilltree freeze stable 0.4.0");
	});

	test("PR4 tag deleted upstream before anything was preserved → error", async () => {
		const fx = await buildFixture();
		await simpleGit(fx.bareDir).raw(["tag", "-d", "v0.4.0"]);

		const result = await resolveAll(frozenManifest(fx.repo), fx.dir);

		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("Frozen tag not found");
		expect(result.errors[0]).toContain("stable");
	});

	test("PR5 readRef returns null for a missing ref and round-trips writeRef", async () => {
		const fx = await buildFixture();
		const ref = `${FROZEN_REF_PREFIX}9.9.9`;

		expect(await readRef(fx.bareDir, ref)).toBeNull();
		await writeRef(fx.bareDir, ref, fx.newCommit);
		expect(await readRef(fx.bareDir, ref)).toBe(fx.newCommit);
	});
});
