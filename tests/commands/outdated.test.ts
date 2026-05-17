import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { installCommand } from "../../src/commands/install.js";
import { outdatedCommand } from "../../src/commands/outdated.js";
import { addTagToRepo, createLocalSkill, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-outdated-"));
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

async function makeBareClone(repoDir: string, baseDir: string, name: string): Promise<string> {
	const bareDir = join(baseDir, `${name}.git`);
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	return bareDir;
}

function captureConsole(): { logs: string[]; restore: () => void } {
	const logs: string[] = [];
	const originalLog = console.log;
	console.log = (...args: unknown[]) => logs.push(args.join(" "));
	return { logs, restore: () => (console.log = originalLog) };
}

// Reset exitCode between tests so `--check` leakage doesn't fail unrelated cases
let savedExitCode: typeof process.exitCode;
beforeEach(() => {
	savedExitCode = process.exitCode;
	process.exitCode = 0;
});
afterEach(() => {
	process.exitCode = savedExitCode;
});

describe("outdatedCommand", () => {
	test("empty lockfile prints empty array under --json", async () => {
		const dir = await makeTempDir();
		await writeManifest(dir, "name: test\n");

		const { logs, restore } = captureConsole();
		try {
			await outdatedCommand(dir, undefined, { json: true });
		} finally {
			restore();
		}

		expect(logs.join("").trim()).toBe("[]");
	});

	test("empty lockfile prints informational message in table mode", async () => {
		const dir = await makeTempDir();
		await writeManifest(dir, "name: test\n");

		const { logs, restore } = captureConsole();
		try {
			await outdatedCommand(dir, undefined, {});
		} finally {
			restore();
		}

		expect(logs.some((l) => l.includes("No dependencies"))).toBe(true);
	});

	test("local dep shows current=local and bump=null", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeManifest(dir, "dependencies:\n  my-skill:\n    local: ./skills/my-skill\n");
		await installCommand(dir, {});

		const { logs, restore } = captureConsole();
		try {
			await outdatedCommand(dir, undefined, { json: true });
		} finally {
			restore();
		}

		const rows = JSON.parse(logs.join("")) as Array<Record<string, unknown>>;
		const row = rows.find((r) => r.name === "my-skill");
		expect(row).toBeDefined();
		expect(row?.current).toBe("local");
		expect(row?.latest).toBeNull();
		expect(row?.bump).toBeNull();
	});

	test("remote dep at v1.0.0 with v2.0.0 available shows bump=major", async () => {
		const dir = await makeTempDir();

		const repoDir = await createTestRepo(
			dir,
			"repo",
			[{ path: "skills/my-skill", name: "my-skill" }],
			"v1.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "bare");

		await writeManifest(
			dir,
			`dependencies:\n  my-skill:\n    repo: "file://${bareDir}"\n    path: skills/my-skill\n    version: "1.0.0"\n`,
		);
		await installCommand(dir, {});

		// Add v2.0.0 to the upstream but do NOT update lockfile (outdated must be read-only)
		await addTagToRepo(repoDir, bareDir, "v2.0.0", [{ path: "skills/my-skill", name: "my-skill" }]);

		const { logs, restore } = captureConsole();
		try {
			await outdatedCommand(dir, undefined, { json: true });
		} finally {
			restore();
		}

		const rows = JSON.parse(logs.join("")) as Array<Record<string, unknown>>;
		const row = rows.find((r) => r.name === "my-skill");
		expect(row).toBeDefined();
		expect(row?.current).toBe("1.0.0");
		expect(row?.latest).toBe("2.0.0");
		expect(row?.bump).toBe("major");
	});

	test("remote dep on latest version shows bump=null", async () => {
		const dir = await makeTempDir();

		const repoDir = await createTestRepo(
			dir,
			"repo",
			[{ path: "skills/my-skill", name: "my-skill" }],
			"v1.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "bare");

		await writeManifest(
			dir,
			`dependencies:\n  my-skill:\n    repo: "file://${bareDir}"\n    path: skills/my-skill\n    version: "*"\n`,
		);
		await installCommand(dir, {});

		const { logs, restore } = captureConsole();
		try {
			await outdatedCommand(dir, undefined, { json: true });
		} finally {
			restore();
		}

		const rows = JSON.parse(logs.join("")) as Array<Record<string, unknown>>;
		const row = rows.find((r) => r.name === "my-skill");
		expect(row).toBeDefined();
		expect(row?.bump).toBeNull();
	});

	test("--check exits with code 1 when drift exists", async () => {
		const dir = await makeTempDir();

		const repoDir = await createTestRepo(
			dir,
			"repo",
			[{ path: "skills/my-skill", name: "my-skill" }],
			"v1.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "bare");

		await writeManifest(
			dir,
			`dependencies:\n  my-skill:\n    repo: "file://${bareDir}"\n    path: skills/my-skill\n    version: "1.0.0"\n`,
		);
		await installCommand(dir, {});
		await addTagToRepo(repoDir, bareDir, "v2.0.0", [{ path: "skills/my-skill", name: "my-skill" }]);

		const { restore } = captureConsole();
		try {
			await outdatedCommand(dir, undefined, { json: true, check: true });
		} finally {
			restore();
		}

		expect(process.exitCode).toBe(1);
	});

	test("--check exits 0 when no drift (only local deps)", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeManifest(dir, "dependencies:\n  my-skill:\n    local: ./skills/my-skill\n");
		await installCommand(dir, {});

		const { restore } = captureConsole();
		try {
			await outdatedCommand(dir, undefined, { json: true, check: true });
		} finally {
			restore();
		}

		expect(process.exitCode).toBeFalsy(); // 0 or undefined
	});

	test("positional name filters to one dep", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "skill-a");
		await createLocalSkill(join(dir, "skills"), "skill-b");
		await writeManifest(
			dir,
			"dependencies:\n  skill-a:\n    local: ./skills/skill-a\n  skill-b:\n    local: ./skills/skill-b\n",
		);
		await installCommand(dir, {});

		const { logs, restore } = captureConsole();
		try {
			await outdatedCommand(dir, "skill-a", { json: true });
		} finally {
			restore();
		}

		const rows = JSON.parse(logs.join("")) as Array<Record<string, unknown>>;
		expect(rows.length).toBe(1);
		expect(rows[0]?.name).toBe("skill-a");
	});

	test("positional name that doesn't exist errors", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "real");
		await writeManifest(dir, "dependencies:\n  real:\n    local: ./skills/real\n");
		await installCommand(dir, {});

		await expect(outdatedCommand(dir, "nonexistent", {})).rejects.toThrow();
	});

	test("does NOT write or modify the lockfile (snapshot test)", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"repo",
			[{ path: "skills/my-skill", name: "my-skill" }],
			"v1.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "bare");

		await writeManifest(
			dir,
			`dependencies:\n  my-skill:\n    repo: "file://${bareDir}"\n    path: skills/my-skill\n    version: "1.0.0"\n`,
		);
		await installCommand(dir, {});

		await addTagToRepo(repoDir, bareDir, "v2.0.0", [{ path: "skills/my-skill", name: "my-skill" }]);

		const lockPath = join(dir, "skilltree.lock");
		const manifestPath = join(dir, "skilltree.yml");

		const lockBefore = await readFile(lockPath, "utf-8");
		const manifestBefore = await readFile(manifestPath, "utf-8");
		const lockMtimeBefore = (await stat(lockPath)).mtimeMs;
		const manifestMtimeBefore = (await stat(manifestPath)).mtimeMs;

		const { restore } = captureConsole();
		try {
			await outdatedCommand(dir, undefined, { json: true });
		} finally {
			restore();
		}

		const lockAfter = await readFile(lockPath, "utf-8");
		const manifestAfter = await readFile(manifestPath, "utf-8");
		const lockMtimeAfter = (await stat(lockPath)).mtimeMs;
		const manifestMtimeAfter = (await stat(manifestPath)).mtimeMs;

		expect(lockAfter).toBe(lockBefore);
		expect(manifestAfter).toBe(manifestBefore);
		expect(lockMtimeAfter).toBe(lockMtimeBefore);
		expect(manifestMtimeAfter).toBe(manifestMtimeBefore);
	});

	test("commit-only resolved (no semver tags) shows latest=null, bump=null", async () => {
		const dir = await makeTempDir();
		// Repo without any semver tags
		const repoDir = await createTestRepo(dir, "repo", [
			{ path: "skills/my-skill", name: "my-skill" },
		]);
		const bareDir = await makeBareClone(repoDir, dir, "bare");

		await writeManifest(
			dir,
			`dependencies:\n  my-skill:\n    repo: "file://${bareDir}"\n    path: skills/my-skill\n`,
		);
		await installCommand(dir, {});

		const { logs, restore } = captureConsole();
		try {
			await outdatedCommand(dir, undefined, { json: true });
		} finally {
			restore();
		}

		const rows = JSON.parse(logs.join("")) as Array<Record<string, unknown>>;
		const row = rows.find((r) => r.name === "my-skill");
		expect(row).toBeDefined();
		expect(row?.current).toMatch(/^@[0-9a-f]+$/); // @<short-sha>
		expect(row?.latest).toBeNull();
		expect(row?.bump).toBeNull();
	});

	test("missing remote (bad repo URL) shows bump='error'", async () => {
		const dir = await makeTempDir();
		// Write a synthetic lockfile pointing at a nonexistent file:// URL.
		await writeManifest(dir, "name: test\n");
		await writeFile(
			join(dir, "skilltree.lock"),
			`lockfile_version: 1
packages:
  ghost-skill:
    type: skill
    group: prod
    repo: "file://${dir}/does-not-exist.git"
    path: skills/ghost
    version: 1.0.0
    commit: deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
    dependencies: []
`,
		);

		const { logs, restore } = captureConsole();
		try {
			await outdatedCommand(dir, undefined, { json: true });
		} finally {
			restore();
		}

		const rows = JSON.parse(logs.join("")) as Array<Record<string, unknown>>;
		const row = rows.find((r) => r.name === "ghost-skill");
		expect(row).toBeDefined();
		expect(row?.bump).toBe("error");
		expect(row?.latest).toBeNull();
	});

	test("table output includes Name, Current, Latest, Bump columns", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeManifest(dir, "dependencies:\n  my-skill:\n    local: ./skills/my-skill\n");
		await installCommand(dir, {});

		const { logs, restore } = captureConsole();
		try {
			await outdatedCommand(dir, undefined, {});
		} finally {
			restore();
		}

		const out = logs.join("\n");
		expect(out).toContain("Name");
		expect(out).toContain("Current");
		expect(out).toContain("Latest");
		expect(out).toContain("Bump");
		expect(out).toContain("my-skill");
		expect(out).toContain("local");
	});

	test("bare command (no name) lists all deps", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "skill-a");
		await createLocalSkill(join(dir, "skills"), "skill-b");
		await writeManifest(
			dir,
			"dependencies:\n  skill-a:\n    local: ./skills/skill-a\n  skill-b:\n    local: ./skills/skill-b\n",
		);
		await installCommand(dir, {});

		const { logs, restore } = captureConsole();
		try {
			await outdatedCommand(dir, undefined, { json: true });
		} finally {
			restore();
		}

		const rows = JSON.parse(logs.join("")) as Array<Record<string, unknown>>;
		expect(rows.length).toBe(2);
	});
});
