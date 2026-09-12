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
	/**
	 * #190: `update <name>` clears the target's lockfile entries and then calls
	 * `install`, which diffs manifest against lockfile, sees entries the
	 * manifest declares and the lockfile lacks, and announces "Manifest
	 * changed." The manifest did not change — `update` manufactured the
	 * divergence a moment earlier. `install` cannot tell the two apart from the
	 * diff alone, so the caller has to say which it is.
	 */
	test("selective update does not claim the manifest changed", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeFile(
			join(dir, "skilltree.yml"),
			"dependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);
		await installCommand(dir, {});

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (msg?: unknown) => {
			logs.push(String(msg));
		};
		try {
			await updateCommand(dir, "my-skill", {});
		} finally {
			console.log = originalLog;
		}

		expect(logs.some((l) => l.includes("Manifest changed"))).toBe(false);
		// It is still resolving, and should say so.
		expect(logs.some((l) => l.includes("Resolving dependencies..."))).toBe(true);
	});

	/**
	 * The other half of #190: a genuine manifest edit must keep the accurate
	 * line. The fix is a caller-supplied reason, not deleting the message.
	 */
	test("a real manifest change still says so", async () => {
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

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (msg?: unknown) => {
			logs.push(String(msg));
		};
		try {
			await installCommand(dir, {});
		} finally {
			console.log = originalLog;
		}

		expect(logs.some((l) => l.includes("Manifest changed"))).toBe(true);
	});

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
