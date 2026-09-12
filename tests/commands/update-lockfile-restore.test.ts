import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand } from "../../src/commands/install.js";
import { updateCommand } from "../../src/commands/update.js";
import { writeGlobalManifest } from "../../src/core/manifest.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

/**
 * #204: a failed `update` must leave `skilltree.lock` exactly as it was.
 *
 * `updateAll` deleted the lockfile before resolving and `selectiveUpdate`
 * wrote back a trimmed one, so a resolution failure left the user with no
 * usable pins — `verify`, `doctor` and `install --frozen` all stopped
 * working, and `doctor` blamed the user for a missing lockfile.
 *
 * Sibling of #67, which fixed the same ordering for `--dry-run` only.
 */

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-update-restore-"));
	return tempDir;
}

/**
 * Install one local skill, then make it depend on a skill that does not
 * exist. The next resolution fails with "Resolution failed" — the same shape
 * as the upstream-removed-a-skill case in the issue, without needing network.
 */
async function installThenBreak(dir: string): Promise<string> {
	await createLocalSkill(join(dir, "skills"), "my-skill");
	await writeFile(
		join(dir, "skilltree.yml"),
		"dependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
	);
	await installCommand(dir, {});
	const lockBefore = await readFile(join(dir, "skilltree.lock"), "utf-8");

	await createLocalSkill(join(dir, "skills"), "my-skill", ["ghost-skill"]);
	return lockBefore;
}

async function readLockOrNull(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf-8");
	} catch {
		return null;
	}
}

describe("update preserves the lockfile when resolution fails (#204)", () => {
	test("update all leaves skilltree.lock byte-identical", async () => {
		const dir = await makeTempDir();
		const lockBefore = await installThenBreak(dir);

		await expect(updateCommand(dir, undefined, {})).rejects.toThrow("Resolution failed");

		expect(await readLockOrNull(join(dir, "skilltree.lock"))).toBe(lockBefore);
	});

	test("selective update leaves skilltree.lock byte-identical", async () => {
		const dir = await makeTempDir();
		const lockBefore = await installThenBreak(dir);

		await expect(updateCommand(dir, "my-skill", {})).rejects.toThrow("Resolution failed");

		expect(await readLockOrNull(join(dir, "skilltree.lock"))).toBe(lockBefore);
	});

	test("restoring does not create a lockfile that never existed", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill", ["ghost-skill"]);
		await writeFile(
			join(dir, "skilltree.yml"),
			"dependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);

		await expect(updateCommand(dir, undefined, {})).rejects.toThrow("Resolution failed");

		expect(await readLockOrNull(join(dir, "skilltree.lock"))).toBeNull();
	});

	test("a successful update still rewrites the lockfile", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeFile(
			join(dir, "skilltree.yml"),
			"dependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);
		await installCommand(dir, {});

		await createLocalSkill(join(dir, "skills"), "second-skill");
		await writeFile(
			join(dir, "skilltree.yml"),
			"dependencies:\n  my-skill:\n    local: ./skills/my-skill\n  second-skill:\n    local: ./skills/second-skill\n",
		);
		await updateCommand(dir, undefined, {});

		const lock = await readFile(join(dir, "skilltree.lock"), "utf-8");
		expect(lock).toContain("second-skill");
	});

	test("global update leaves global.lock byte-identical", async () => {
		const dir = await makeTempDir();
		const globalDir = join(dir, "globalhome");
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeGlobalManifest(
			{ dependencies: { "my-skill": { local: join(dir, "skills", "my-skill") } } },
			globalDir,
		);
		await installCommand(dir, { global: true, globalDir });
		const lockPath = join(globalDir, "global.lock");
		const lockBefore = await readFile(lockPath, "utf-8");

		await createLocalSkill(join(dir, "skills"), "my-skill", ["ghost-skill"]);

		await expect(updateCommand(dir, undefined, { global: true, globalDir })).rejects.toThrow(
			"Resolution failed",
		);

		expect(await readLockOrNull(lockPath)).toBe(lockBefore);
	});
});
