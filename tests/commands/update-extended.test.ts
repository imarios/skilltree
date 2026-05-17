import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand } from "../../src/commands/install.js";
import { updateCommand } from "../../src/commands/update.js";
import { parseLockfile } from "../../src/core/lockfile.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-update-ext-"));
	return tempDir;
}

describe("updateCommand extended", () => {
	test("update all deletes lockfile and re-installs", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeFile(
			join(dir, "skilltree.yml"),
			"dependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);
		await installCommand(dir, {});

		// Update all
		await updateCommand(dir, undefined, {});

		// Lockfile should still exist (re-created)
		const lockContent = await readFile(join(dir, "skilltree.lock"), "utf-8");
		const lockfile = parseLockfile(lockContent);
		expect(lockfile.packages["my-skill"]).toBeDefined();
	});

	test("selective update on non-existent dep errors", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeFile(
			join(dir, "skilltree.yml"),
			"dependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);
		await installCommand(dir, {});

		await expect(updateCommand(dir, "nonexistent", {})).rejects.toThrow("not in skilltree.yml");
	});

	test("selective update on local dep re-reads from filesystem", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeFile(
			join(dir, "skilltree.yml"),
			"dependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);
		await installCommand(dir, {});

		// Modify the skill source
		await writeFile(
			join(dir, "skills", "my-skill", "SKILL.md"),
			"---\nname: my-skill\n---\n\n# Updated\n",
		);

		// Selective update
		await updateCommand(dir, "my-skill", {});

		const lockContent = await readFile(join(dir, "skilltree.lock"), "utf-8");
		const lockfile = parseLockfile(lockContent);
		expect(lockfile.packages["my-skill"]).toBeDefined();
	});

	test("update without lockfile runs full install", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeFile(
			join(dir, "skilltree.yml"),
			"dependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);

		// No lockfile — update should do full install
		await updateCommand(dir, "my-skill", {});

		const lockContent = await readFile(join(dir, "skilltree.lock"), "utf-8");
		const lockfile = parseLockfile(lockContent);
		expect(lockfile.packages["my-skill"]).toBeDefined();
	});

	test("update --dry-run (all) does not delete the lockfile", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeFile(
			join(dir, "skilltree.yml"),
			"dependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);
		await installCommand(dir, {});

		const before = await readFile(join(dir, "skilltree.lock"), "utf-8");

		// Bare update --dry-run should preview without touching the lockfile
		await updateCommand(dir, undefined, { dryRun: true });

		const after = await readFile(join(dir, "skilltree.lock"), "utf-8");
		expect(after).toBe(before);
	});

	test("update <name> --dry-run does not clear lockfile entries", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeFile(
			join(dir, "skilltree.yml"),
			"dependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);
		await installCommand(dir, {});

		const before = await readFile(join(dir, "skilltree.lock"), "utf-8");
		const beforeParsed = parseLockfile(before);
		expect(beforeParsed.packages["my-skill"]).toBeDefined();

		// Selective update --dry-run must not clear the entry
		await updateCommand(dir, "my-skill", { dryRun: true });

		const after = await readFile(join(dir, "skilltree.lock"), "utf-8");
		expect(after).toBe(before);
	});
});
