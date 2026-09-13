/**
 * Concurrent `ensureCached` calls on one repo must not destroy the cache.
 *
 * `outdated` builds its rows in parallel, so two deps from the same repo fetch
 * the same bare cache at once. Concurrent fetches can fail on git's ref locks,
 * and `cloneOrFetchBare` treats any fetch failure as a corrupt cache: it
 * deletes the directory and re-clones. The other caller's tag listing then
 * fails (`outdated` reported `latest: null`), and the re-clone drops the
 * preserved refs frozen deps rely on (#203). Found via CI on PR #218.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import {
	ensureCached,
	FROZEN_REF_PREFIX,
	listTags,
	readRef,
	writeRef,
} from "../../src/core/git.js";
import { addTagToRepo, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string | undefined;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
	tempDir = undefined;
});

describe("ensureCached concurrency", () => {
	test("parallel fetches of one repo all succeed, see new tags, and keep preserved refs", async () => {
		const dir = await mkdtemp(join(tmpdir(), "skilltree-cache-race-"));
		tempDir = dir;
		const skills = [{ path: "skills/stable", name: "stable" }];
		const repoDir = await createTestRepo(dir, "upstream", skills, "v0.4.0");
		const bareDir = join(dir, "upstream.git");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);
		const repo = `file://${bareDir}`;

		const cachePath = await ensureCached(repo);
		const preserved = `${FROZEN_REF_PREFIX}0.4.0`;
		const commit = (await simpleGit(cachePath).revparse(["v0.4.0^{commit}"])).trim();
		await writeRef(cachePath, preserved, commit);

		for (const tag of ["v0.5.0", "v0.6.0", "v0.7.0"]) {
			await addTagToRepo(repoDir, bareDir, tag, skills);
		}

		const results = await Promise.all(
			Array.from({ length: 8 }, async () => listTags(await ensureCached(repo))),
		);

		for (const tags of results) {
			expect(tags).toContain("v0.7.0");
		}
		expect(await readRef(cachePath, preserved)).toBe(commit);
	}, 60_000);
});
