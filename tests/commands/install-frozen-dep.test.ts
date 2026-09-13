/**
 * Neon Phase 1 (#203): frozen deps and the lockfile.
 *
 * No lockfile schema change — entries already record `version` and `commit`.
 * What must hold: install records the frozen tag, editing `frozen:` makes the
 * next install re-resolve instead of trusting the lockfile, and a lockfile
 * install keeps working after upstream drops the tag.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { installCommand } from "../../src/commands/install.js";
import { readLockfile } from "../../src/core/lockfile.js";
import { addTagToRepo, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string | undefined;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
	tempDir = undefined;
});

interface Fixture {
	projectDir: string;
	bareDir: string;
	oldCommit: string;
	newCommit: string;
}

async function buildFixture(): Promise<Fixture> {
	const dir = await mkdtemp(join(tmpdir(), "skilltree-install-frozen-"));
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

	const projectDir = join(dir, "project");
	await mkdir(projectDir, { recursive: true });
	const bare = simpleGit(bareDir);
	return {
		projectDir,
		bareDir,
		oldCommit: (await bare.revparse(["v0.4.0^{commit}"])).trim(),
		newCommit: (await bare.revparse(["v0.6.0^{commit}"])).trim(),
	};
}

async function writeFrozenManifest(fx: Fixture, frozen: string): Promise<void> {
	await writeFile(
		join(fx.projectDir, "skilltree.yml"),
		`dependencies:
  stable:
    repo: "file://${fx.bareDir}"
    path: skills/stable
    type: skill
    frozen: "${frozen}"
`,
	);
}

function installedSkill(fx: Fixture): Promise<string> {
	return readFile(join(fx.projectDir, ".claude", "skills", "stable", "SKILL.md"), "utf-8");
}

describe("install: frozen deps and the lockfile (#203)", () => {
	test("LI1 install records the frozen tag's version and commit", async () => {
		const fx = await buildFixture();
		await writeFrozenManifest(fx, "0.4.0");

		await installCommand(fx.projectDir, {});

		const entry = (await readLockfile(fx.projectDir))?.packages.stable;
		expect(entry?.version).toBe("0.4.0");
		expect(entry?.commit).toBe(fx.oldCommit);
		expect(await installedSkill(fx)).not.toContain("Updated content for v0.6.0");
	});

	test("LI2 changing frozen: re-resolves instead of reusing the lockfile", async () => {
		const fx = await buildFixture();
		await writeFrozenManifest(fx, "0.4.0");
		await installCommand(fx.projectDir, {});

		await writeFrozenManifest(fx, "0.6.0");
		await installCommand(fx.projectDir, {});

		const entry = (await readLockfile(fx.projectDir))?.packages.stable;
		expect(entry?.version).toBe("0.6.0");
		expect(entry?.commit).toBe(fx.newCommit);
		expect(await installedSkill(fx)).toContain("Updated content for v0.6.0");
	});

	test("LI3 a lockfile install still works after upstream deletes the frozen tag", async () => {
		const fx = await buildFixture();
		await writeFrozenManifest(fx, "0.4.0");
		await installCommand(fx.projectDir, {});
		await rm(join(fx.projectDir, ".claude"), { recursive: true, force: true });
		await simpleGit(fx.bareDir).raw(["tag", "-d", "v0.4.0"]);

		await installCommand(fx.projectDir, {});

		const entry = (await readLockfile(fx.projectDir))?.packages.stable;
		expect(entry?.commit).toBe(fx.oldCommit);
		expect(await installedSkill(fx)).not.toContain("Updated content for v0.6.0");
	});
});
