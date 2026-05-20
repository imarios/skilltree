/**
 * Issue #119 Bug B: lockfile/disk desync via skip-with-rewrite.
 *
 * Repro: install pins a repo at a higher version, then a second install
 * tightens a sibling constraint that downgrades the whole repo. The
 * installer warns "already installed. Use --force to overwrite", skips the
 * file copy, but the lockfile still gets rewritten with the new (lower)
 * version + commit. The recorded integrity hash is stale (preserved from
 * the previous install) — `skilltree verify` reports OK even though the
 * lockfile lies about what's on disk.
 *
 * Fix: when the lockfile records a different commit for an entity than the
 * one currently resolved, the installer must overwrite (independent of
 * --force) so disk and lockfile agree.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { installCommand } from "../../src/commands/install.js";
import { computeIntegrity } from "../../src/core/installer.js";
import { readLockfile } from "../../src/core/lockfile.js";
import { addTagToRepo, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-version-change-"));
	return tempDir;
}

async function makeBareClone(repoDir: string, baseDir: string, name: string): Promise<string> {
	const bareDir = join(baseDir, `${name}.git`);
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	return bareDir;
}

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("install: version change must overwrite on-disk files (#119 Bug B)", () => {
	test("tighter sibling constraint downgrades repo; files updated, lockfile/disk in sync", async () => {
		const dir = await makeTempDir();
		// Three commands tagged at v0.5.0 (low) and v0.8.0 (high), with
		// distinct file content per tag (addTagToRepo's "Updated content
		// for v0.8.0" suffix lands on disk).
		const repoDir = await createTestRepo(
			dir,
			"vibes",
			[
				{ path: "commands/exp.md", name: "exp", isAgent: true },
				{ path: "commands/tut.md", name: "tut", isAgent: true },
			],
			"v0.5.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "vibes-bare");
		await addTagToRepo(repoDir, bareDir, "v0.8.0", [
			{ path: "commands/exp.md", name: "exp", isAgent: true },
			{ path: "commands/tut.md", name: "tut", isAgent: true },
		]);

		const projectDir = join(dir, "project");
		await mkdir(projectDir, { recursive: true });

		// Round 1: install at the high version (exp@* alone → 0.8.0).
		const manifestV1 = `dependencies:
  exp:
    repo: "file://${bareDir}"
    path: commands/exp.md
    type: agent
    version: "*"
`;
		await writeFile(join(projectDir, "skilltree.yml"), manifestV1);

		await installCommand(projectDir, {});

		const expFileV1 = join(projectDir, ".claude", "agents", "exp.md");
		const expContentV1 = await readFile(expFileV1, "utf-8");
		// addTagToRepo writes "# <name> Agent v2\n" for agent modifications,
		// distinct from the v1 body "# <name> Agent\n".
		expect(expContentV1).toContain("Agent v2");

		const lockV1 = await readLockfile(projectDir);
		expect(lockV1?.packages.exp?.version).toBe("0.8.0");

		// Round 2: add `tut@^0.5.0` to the manifest. The repo intersection
		// now caps at 0.5.0, so `exp` is downgraded.
		const manifestV2 = `dependencies:
  exp:
    repo: "file://${bareDir}"
    path: commands/exp.md
    type: agent
    version: "*"
  tut:
    repo: "file://${bareDir}"
    path: commands/tut.md
    type: agent
    version: "^0.5.0"
`;
		await writeFile(join(projectDir, "skilltree.yml"), manifestV2);

		await installCommand(projectDir, {});

		// Lockfile now claims 0.5.0 for exp.
		const lockV2 = await readLockfile(projectDir);
		expect(lockV2?.packages.exp?.version).toBe("0.5.0");
		const lockedExpIntegrity = lockV2?.packages.exp?.integrity;
		expect(lockedExpIntegrity).toBeDefined();

		// Disk must now hold the 0.5.0 content (not the cached 0.8.0).
		const expContentV2 = await readFile(expFileV1, "utf-8");
		expect(expContentV2).not.toBe(expContentV1);

		// And the lockfile's recorded integrity hash must match the actual
		// on-disk content — the core invariant Bug B violated.
		const actualIntegrity = await computeIntegrity(expFileV1);
		expect(actualIntegrity).toBe(lockedExpIntegrity as string);
	});
});
