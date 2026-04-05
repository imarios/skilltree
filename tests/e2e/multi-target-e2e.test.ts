import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand } from "../../src/commands/install.js";
import { parseLockfile } from "../../src/core/lockfile.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-multi-target-"));
	return tempDir;
}

async function writeManifest(dir: string, content: string): Promise<void> {
	await writeFile(join(dir, "skilltree.yaml"), content, "utf-8");
}

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("e2e multi-target install", () => {
	test("install_targets: [claude, codex] installs to both directories", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");

		await writeManifest(
			dir,
			"install_targets:\n  - claude\n  - codex\ndependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);

		await installCommand(dir, {});

		// Skill should be in both .claude/skills/ and .codex/skills/
		const claudeSkill = join(dir, ".claude", "skills", "my-skill");
		const codexSkill = join(dir, ".codex", "skills", "my-skill");

		expect(existsSync(claudeSkill)).toBe(true);
		expect(existsSync(codexSkill)).toBe(true);

		const claudeStat = await lstat(claudeSkill);
		expect(claudeStat.isSymbolicLink()).toBe(true);

		const codexStat = await lstat(codexSkill);
		expect(codexStat.isSymbolicLink()).toBe(true);
	});

	test("single target backward compat: installs to .claude/ only", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");

		await writeManifest(
			dir,
			"install_targets:\n  - claude\ndependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);

		await installCommand(dir, {});

		expect(existsSync(join(dir, ".claude", "skills", "my-skill"))).toBe(true);
		expect(existsSync(join(dir, ".codex", "skills", "my-skill"))).toBe(false);
	});

	test("mixed agent + custom path installs to both", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");

		await writeManifest(
			dir,
			"install_targets:\n  - claude\n  - ./custom-agent\ndependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);

		await installCommand(dir, {});

		expect(existsSync(join(dir, ".claude", "skills", "my-skill"))).toBe(true);
		expect(existsSync(join(dir, "custom-agent", "skills", "my-skill"))).toBe(true);
	});

	test("--install-path overrides install_targets for that invocation", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");

		await writeManifest(
			dir,
			"install_targets:\n  - claude\n  - codex\ndependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);

		await installCommand(dir, { installPath: join(dir, ".override") });

		// Only .override should have the skill
		expect(existsSync(join(dir, ".override", "skills", "my-skill"))).toBe(true);
		expect(existsSync(join(dir, ".claude", "skills", "my-skill"))).toBe(false);
		expect(existsSync(join(dir, ".codex", "skills", "my-skill"))).toBe(false);
	});

	test("lockfile records install_targets after install", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");

		await writeManifest(
			dir,
			"install_targets:\n  - claude\n  - codex\ndependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);

		await installCommand(dir, {});

		const lockContent = await readFile(join(dir, "skilltree.lock"), "utf-8");
		const lockfile = parseLockfile(lockContent);
		expect(lockfile.install_targets).toEqual([".claude", ".codex"]);
	});

	test("warns about stale targets in lockfile", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");

		// First install with two targets
		await writeManifest(
			dir,
			"install_targets:\n  - claude\n  - codex\ndependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);
		await installCommand(dir, {});

		// Now remove codex from manifest and reinstall
		await writeManifest(
			dir,
			"install_targets:\n  - claude\ndependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);

		const warnings: string[] = [];
		const origWarn = console.warn;
		console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
		try {
			await installCommand(dir, {});
		} finally {
			console.warn = origWarn;
		}

		expect(warnings.some((w) => w.includes("stale target") && w.includes(".codex"))).toBe(true);
	});
});
