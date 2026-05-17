import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import {
	cloneOrFetchBare,
	ensureCached,
	getCommitSha,
	getDefaultBranch,
	listDirAtRef,
	listTags,
	lsRemote,
	readFileAtRef,
	repoCachePath,
} from "../../src/core/git.js";
import { createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-git-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("lsRemote", () => {
	test("returns { ok: true } against a reachable local repo", async () => {
		// `file://` against a fresh test repo — exercises the success path
		// without needing network or a real remote. Mirrors how registries are
		// reached locally in CI.
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(dir, "reachable", [{ path: "skills/a", name: "a" }]);

		const outcome = await lsRemote(`file://${repoDir}`);

		expect(outcome.ok).toBe(true);
	});

	test("returns { ok: false, reason: 'unreachable' } when the path doesn't exist", async () => {
		// Bad file:// path → git fails with "does not appear to be a git repo"
		// or similar. The categorization heuristic should land it in either
		// `unreachable` or `other` — both are non-fatal for `add`, but tests
		// against the actual category we shipped behavior for.
		const dir = await makeTempDir();
		const fakePath = join(dir, "does-not-exist");

		const outcome = await lsRemote(`file://${fakePath}`);

		expect(outcome.ok).toBe(false);
		// The exact reason depends on git's error text — both unreachable and
		// other are legitimate; we just need a stable non-ok signal here.
		if (!outcome.ok) {
			expect(["unreachable", "other"]).toContain(outcome.reason);
			expect(outcome.detail).toBeTruthy();
		}
	});

	test("respects the timeout when the probe stalls", async () => {
		// 1ms timeout against any URL is essentially guaranteed to fire the
		// timer before simpleGit returns. We're testing the race-resolution
		// shape, not the underlying git call. A non-existent URL is fine here
		// — the probe either times out (timer wins) or fails fast (git wins).
		const outcome = await lsRemote("file:///dev/null/nope", { timeoutMs: 1 });

		expect(outcome.ok).toBe(false);
		if (!outcome.ok) {
			// Whichever side of the race won; both are valid terminal states.
			expect(["timeout", "unreachable", "other"]).toContain(outcome.reason);
		}
	});
});

describe("repoCachePath", () => {
	test("normalizes plain domain/path", () => {
		const result = repoCachePath("github.com/user/repo");
		expect(result).toContain("github.com/user/repo");
	});

	test("strips https:// prefix", () => {
		const result = repoCachePath("https://github.com/user/repo");
		expect(result).toContain("github.com/user/repo");
		expect(result).not.toContain("https://");
	});

	test("strips git@ prefix and converts : to /", () => {
		const result = repoCachePath("git@github.com:user/repo");
		expect(result).toContain("github.com/user/repo");
		expect(result).not.toContain("git@");
		expect(result).not.toContain(":");
	});

	test("strips trailing .git", () => {
		const result = repoCachePath("github.com/user/repo.git");
		expect(result).not.toMatch(/\.git$/);
		expect(result).toContain("github.com/user/repo");
	});

	test("strips trailing slashes", () => {
		const result = repoCachePath("github.com/user/repo/");
		expect(result).not.toMatch(/\/$/);
	});

	test("handles http:// prefix", () => {
		const result = repoCachePath("http://gitlab.com/org/project");
		expect(result).toContain("gitlab.com/org/project");
		expect(result).not.toContain("http://");
	});
});

describe("git operations with local bare repo", () => {
	test("ensureCached clones a local repo via file:// URL", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(dir, "test-repo", [
			{ path: "skills/my-skill", name: "my-skill" },
		]);

		// Create a bare clone to simulate a cached repo
		const bareDir = join(dir, "bare-repo");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		// ensureCached with file:// should fetch an existing bare repo
		const cachePath = await ensureCached(`file://${bareDir}`);
		expect(cachePath).toBeTruthy();
	});

	test("listTags returns tags from bare repo", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"tagged-repo",
			[{ path: "skills/my-skill", name: "my-skill" }],
			"v1.0.0",
		);

		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const tags = await listTags(bareDir);
		expect(tags).toContain("v1.0.0");
	});

	test("readFileAtRef reads file content at a tag", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"content-repo",
			[{ path: "skills/my-skill", name: "my-skill" }],
			"v1.0.0",
		);

		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const content = await readFileAtRef(bareDir, "v1.0.0", "skills/my-skill/SKILL.md");
		expect(content).toContain("name: my-skill");
	});

	test("listDirAtRef lists directory contents at a tag", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"dir-repo",
			[
				{ path: "skills/skill-a", name: "skill-a" },
				{ path: "skills/skill-b", name: "skill-b" },
			],
			"v1.0.0",
		);

		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const entries = await listDirAtRef(bareDir, "v1.0.0", "skills");
		expect(entries).toContain("skill-a");
		expect(entries).toContain("skill-b");
	});

	test("listDirAtRef with '.' lists root", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"root-repo",
			[{ path: "skills/my-skill", name: "my-skill" }],
			"v1.0.0",
		);

		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const entries = await listDirAtRef(bareDir, "v1.0.0", ".");
		expect(entries).toContain("skills");
	});

	test("getCommitSha returns SHA for a tag", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"sha-repo",
			[{ path: "skills/my-skill", name: "my-skill" }],
			"v1.0.0",
		);

		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const sha = await getCommitSha(bareDir, "v1.0.0");
		expect(sha).toMatch(/^[a-f0-9]{40}$/);
	});

	test("getDefaultBranch returns main/master", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(dir, "branch-repo", [
			{ path: "skills/my-skill", name: "my-skill" },
		]);

		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const branch = await getDefaultBranch(bareDir);
		expect(["main", "master"]).toContain(branch);
	});
});

describe("cloneOrFetchBare", () => {
	// Regression: issue #55 — bare clones produced by `git clone --bare` have no
	// remote.origin.fetch refspec. A subsequent `git fetch --tags --prune`
	// updates tags but leaves refs/heads/* frozen at clone time, so new commits
	// on the default branch are silently missed.
	test("picks up new commits on the default branch on re-fetch (issue #55)", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(dir, "src-repo", [{ path: "skills/a", name: "a" }]);
		const bareDir = join(dir, "bare-cache");

		// First call: clones from scratch.
		await cloneOrFetchBare(`file://${repoDir}`, bareDir);
		const branch = await getDefaultBranch(bareDir);
		const initialSha = await getCommitSha(bareDir, branch);

		// Advance the source by one commit on the default branch.
		const srcGit = simpleGit(repoDir);
		await writeFile(join(repoDir, "newfile.txt"), "x");
		await srcGit.add(".");
		await srcGit.commit("second");
		const newSrcSha = (await srcGit.revparse(["HEAD"])).trim();
		expect(newSrcSha).not.toBe(initialSha);

		// Second call: must fetch the new commit into the bare clone's
		// refs/heads/<branch>, not just resolve it into FETCH_HEAD.
		await cloneOrFetchBare(`file://${repoDir}`, bareDir);
		const updatedSha = await getCommitSha(bareDir, branch);

		expect(updatedSha).toBe(newSrcSha);
	});

	// Existing users (pre-fix) have stale caches with no refspec configured.
	// The fix has to be self-healing: when cloneOrFetchBare runs against such a
	// cache, it must backfill the refspec AND pull in the commits the cache
	// missed while the bug was live. Re-cloning would be slow for large repos
	// and would discard reflog/objects unnecessarily.
	test("self-heals a pre-existing bare clone that has no fetch refspec (issue #55)", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(dir, "src-repo", [{ path: "skills/a", name: "a" }]);
		const bareDir = join(dir, "bare-cache");

		// Simulate a cache produced by the old (buggy) code: a plain
		// `git clone --bare` with no refspec configured.
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);
		const bareGit = simpleGit(bareDir);
		// Sanity check: refspec is unset, mirroring the on-disk state of
		// every cache produced by skilltree <= 0.25.1.
		let refspec = "";
		try {
			refspec = (await bareGit.raw(["config", "--get", "remote.origin.fetch"])).trim();
		} catch {
			// `git config --get` exits 1 when the key is missing.
		}
		expect(refspec).toBe("");

		const branch = await getDefaultBranch(bareDir);
		const initialSha = await getCommitSha(bareDir, branch);

		// Advance the source.
		const srcGit = simpleGit(repoDir);
		await writeFile(join(repoDir, "newfile.txt"), "x");
		await srcGit.add(".");
		await srcGit.commit("second");
		const newSrcSha = (await srcGit.revparse(["HEAD"])).trim();
		expect(newSrcSha).not.toBe(initialSha);

		// cloneOrFetchBare should heal the stale cache: install the refspec
		// and fetch the missed commit on the same invocation.
		await cloneOrFetchBare(`file://${repoDir}`, bareDir);

		const healedRefspec = (await bareGit.raw(["config", "--get", "remote.origin.fetch"])).trim();
		expect(healedRefspec).toBe("+refs/heads/*:refs/heads/*");

		const updatedSha = await getCommitSha(bareDir, branch);
		expect(updatedSha).toBe(newSrcSha);
	});

	// Regression for round-1 hypothesis H1: a cache that already has *multiple*
	// remote.origin.fetch entries (e.g. produced by `git clone --mirror`, or
	// hand-edited by a user) would make a plain `git config <name> <value>`
	// exit 5 with "cannot overwrite multiple values with a single value",
	// breaking the self-healing path. ensureBareFetchRefspec must collapse all
	// existing values to the single canonical one.
	test("self-heals a cache that has MULTIPLE pre-existing fetch refspecs (H1)", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(dir, "src-repo", [{ path: "skills/a", name: "a" }]);
		const bareDir = join(dir, "bare-cache");

		// Simulate a cache produced by an older `--mirror` setup or a manual
		// `git config --add`: two distinct fetch refspecs configured.
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);
		const bareGit = simpleGit(bareDir);
		await bareGit.raw(["config", "--add", "remote.origin.fetch", "+refs/heads/*:refs/heads/*"]);
		await bareGit.raw(["config", "--add", "remote.origin.fetch", "+refs/tags/*:refs/tags/*"]);

		// Sanity: two values present.
		const before = (await bareGit.raw(["config", "--get-all", "remote.origin.fetch"])).trim();
		expect(before.split("\n").length).toBe(2);

		// Must not throw — the fix uses --replace-all.
		await cloneOrFetchBare(`file://${repoDir}`, bareDir);

		// After healing, exactly one canonical refspec remains.
		const after = (await bareGit.raw(["config", "--get-all", "remote.origin.fetch"])).trim();
		expect(after).toBe("+refs/heads/*:refs/heads/*");
	});

	// Regression for round-1 hypothesis H2: with the new refspec installed,
	// `git fetch --prune` would delete local refs/heads/<branch> whenever the
	// upstream removed/renamed the branch. Tagless dep resolution in
	// src/core/graph.ts reads getCommitSha(cache, getDefaultBranch(cache)),
	// so pruning the cached default branch under an upstream rename turns
	// that into a hard failure instead of resolving to the last-known commit.
	// cloneOrFetchBare must NOT prune.
	test("preserves locally-cached branches that upstream has deleted (H2)", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(dir, "src-repo", [{ path: "skills/a", name: "a" }]);
		const bareDir = join(dir, "bare-cache");

		// First, clone the cache while a side branch exists upstream.
		const srcGit = simpleGit(repoDir);
		// Capture the default branch BEFORE creating side-branch — must work
		// regardless of `init.defaultBranch` (CI runners often default to
		// `master` while modern local installs default to `main`).
		const defaultBranch = (await srcGit.raw(["symbolic-ref", "--short", "HEAD"])).trim();
		await srcGit.checkoutLocalBranch("side-branch");
		await writeFile(join(repoDir, "side.txt"), "x");
		await srcGit.add(".");
		await srcGit.commit("side commit");
		// Return upstream to its default branch.
		await srcGit.checkout(defaultBranch);

		await cloneOrFetchBare(`file://${repoDir}`, bareDir);

		// Cache has side-branch right after the initial clone.
		const sideShaInitial = await getCommitSha(bareDir, "side-branch");
		expect(sideShaInitial).toMatch(/^[a-f0-9]{40}$/);

		// Upstream deletes side-branch.
		await srcGit.deleteLocalBranch("side-branch", true);

		// Re-fetch. With --prune, side-branch would be deleted locally.
		await cloneOrFetchBare(`file://${repoDir}`, bareDir);

		// The cached branch must still resolve — this is the data point
		// tagless resolution in src/core/graph.ts depends on for repos
		// whose default branch has been renamed upstream.
		const sideShaAfter = await getCommitSha(bareDir, "side-branch");
		expect(sideShaAfter).toBe(sideShaInitial);
	});

	// Regression for round-2 hypothesis H2: dropping `--prune` outright would
	// be wrong in the other direction — upstream-revoked tags must propagate to
	// the cache so `resolveOneRepo` in src/core/graph.ts doesn't keep resolving
	// a revoked tag (e.g. a maintainer's emergency tag deletion pointing at a
	// vulnerable commit). The fix uses `--prune-tags` which prunes tags but
	// leaves branches alone.
	test("prunes upstream-revoked tags from the cache (round-2 H2)", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"src-repo",
			[{ path: "skills/a", name: "a" }],
			"v1.0.0",
		);
		const bareDir = join(dir, "bare-cache");

		// Initial clone — cache mirrors upstream's tags.
		await cloneOrFetchBare(`file://${repoDir}`, bareDir);
		expect(await listTags(bareDir)).toContain("v1.0.0");

		// Upstream revokes v1.0.0 (e.g. emergency tag deletion).
		const srcGit = simpleGit(repoDir);
		await srcGit.raw(["tag", "-d", "v1.0.0"]);

		// Re-fetch. The revoked tag must NOT linger in the cache.
		await cloneOrFetchBare(`file://${repoDir}`, bareDir);
		expect(await listTags(bareDir)).not.toContain("v1.0.0");
	});

	// Regression for round-3 hypothesis H3: when a user has set
	// `clone.defaultRemoteName=upstream` (or any non-default value) in their
	// global gitconfig, `git clone --bare` honors that and names the remote
	// `upstream` instead of `origin`. Without `-o origin`, every other call
	// in cloneOrFetchBare that hardcodes `origin` (ensureBareFetchRefspec
	// writing `remote.origin.fetch`, drift check reading `remote.origin.url`,
	// tag-prune fetch referencing `origin` explicitly) breaks.
	test("honors -o origin regardless of clone.defaultRemoteName (round-3 H3)", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(dir, "src-repo", [{ path: "skills/a", name: "a" }]);
		const bareDir = join(dir, "bare-cache");

		// Inject `clone.defaultRemoteName=upstream` into a scratch global
		// gitconfig and point this process at it. cloneOrFetchBare spawns
		// `git` via simple-git, which inherits this env — so the spawn sees
		// the hostile config. If the fix is in place (`-o origin` on the
		// clone), the cache's remote name MUST still be `origin`.
		const hostileConfig = join(dir, "hostile-gitconfig");
		await writeFile(hostileConfig, "[clone]\n  defaultRemoteName = upstream\n");
		const savedEnv = process.env.GIT_CONFIG_GLOBAL;
		process.env.GIT_CONFIG_GLOBAL = hostileConfig;
		try {
			await cloneOrFetchBare(`file://${repoDir}`, bareDir);
		} finally {
			if (savedEnv === undefined) delete process.env.GIT_CONFIG_GLOBAL;
			else process.env.GIT_CONFIG_GLOBAL = savedEnv;
		}

		const remotes = (await simpleGit(bareDir).raw(["remote"])).trim();
		expect(remotes).toBe("origin");
	});
});
