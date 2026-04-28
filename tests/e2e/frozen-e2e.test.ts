import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand } from "../../src/commands/install.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-frozen-e2e-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function writeManifest(dir: string, content: string): Promise<void> {
	await writeFile(join(dir, "skilltree.yml"), content, "utf-8");
}

describe("frozen mode edge cases", () => {
	test("--frozen with no lockfile errors", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeManifest(dir, "dependencies:\n  my-skill:\n    local: ./skills/my-skill\n");

		await expect(installCommand(dir, { frozen: true })).rejects.toThrow(
			"--frozen requires a lockfile",
		);
	});

	test("--frozen with new manifest entry errors", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "skill-a");
		await createLocalSkill(join(dir, "skills"), "skill-b");

		// Install with only skill-a
		await writeManifest(dir, "dependencies:\n  skill-a:\n    local: ./skills/skill-a\n");
		await installCommand(dir, {});

		// Add skill-b to manifest without updating lockfile
		await writeManifest(
			dir,
			"dependencies:\n  skill-a:\n    local: ./skills/skill-a\n  skill-b:\n    local: ./skills/skill-b\n",
		);

		await expect(installCommand(dir, { frozen: true })).rejects.toThrow(
			"manifest has entries not in lockfile",
		);
	});

	test("--frozen with local dep adding new transitive dep errors", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "base");
		await createLocalSkill(join(dir, "skills"), "top", []);

		await writeManifest(
			dir,
			"dependencies:\n  top:\n    local: ./skills/top\n  base:\n    local: ./skills/base\n",
		);
		await installCommand(dir, {});

		// Now modify top's frontmatter to declare a new transitive dep
		await writeFile(
			join(dir, "skills", "top", "SKILL.md"),
			"---\nname: top\ndependencies:\n  - new-dep\n---\n\n# top\n",
		);

		await expect(installCommand(dir, { frozen: true })).rejects.toThrow("lockfile out of sync");
	});

	test("--frozen does not write lockfile", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeManifest(dir, "dependencies:\n  my-skill:\n    local: ./skills/my-skill\n");

		// Create lockfile
		await installCommand(dir, {});

		const lockBefore = await readFile(join(dir, "skilltree.lock"), "utf-8");

		// Frozen install
		await installCommand(dir, { frozen: true });

		const lockAfter = await readFile(join(dir, "skilltree.lock"), "utf-8");
		expect(lockAfter).toBe(lockBefore);
	});

	test("--frozen + --force installs correctly", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeManifest(dir, "dependencies:\n  my-skill:\n    local: ./skills/my-skill\n");

		await installCommand(dir, {});
		await installCommand(dir, { frozen: true, force: true });

		const stat = await lstat(join(dir, ".claude", "skills", "my-skill"));
		expect(stat.isSymbolicLink()).toBe(true);
	});

	test("--frozen --prod only installs prod deps", async () => {
		const dir = await makeTempDir();
		const buildDir = join(dir, "build", ".claude");
		await createLocalSkill(join(dir, "skills"), "prod-skill");
		await createLocalSkill(join(dir, "skills"), "dev-skill");

		await writeManifest(
			dir,
			"dependencies:\n  prod-skill:\n    local: ./skills/prod-skill\ndev-dependencies:\n  dev-skill:\n    local: ./skills/dev-skill\n",
		);

		await installCommand(dir, {});
		await installCommand(dir, { frozen: true, prod: true, installPath: buildDir });

		// Prod skill exists
		const prodStat = await lstat(join(buildDir, "skills", "prod-skill"));
		expect(prodStat.isDirectory()).toBe(true);

		// Dev skill does not
		try {
			await lstat(join(buildDir, "skills", "dev-skill"));
			expect(true).toBe(false);
		} catch (e: unknown) {
			expect((e as NodeJS.ErrnoException).code).toBe("ENOENT");
		}
	});
});
