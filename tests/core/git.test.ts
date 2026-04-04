import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import {
	ensureCached,
	getCommitSha,
	getDefaultBranch,
	listDirAtRef,
	listTags,
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
