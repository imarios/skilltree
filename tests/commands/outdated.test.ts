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

	// Issue #136: annotate rows whose bump is silently blocked by a tighter
	// sibling constraint in the same repo. Mirrors the #119 "capped by"
	// warning at install/update time so users can preview the cap.
	describe("cappedBy annotation (#136)", () => {
		test("flags '*' dep when sibling ^constraint excludes the latest tag", async () => {
			const dir = await makeTempDir();
			const repoDir = await createTestRepo(
				dir,
				"repo",
				[
					{ path: "skills/exp", name: "exp" },
					{ path: "skills/tut", name: "tut" },
				],
				"v0.5.0",
			);
			const bareDir = await makeBareClone(repoDir, dir, "bare");
			// Tag v0.8.0 BEFORE install so the upstream's "latest" is already
			// 0.8.0 at install time. The resolver still pins both deps at
			// 0.5.0 (capped by tut@^0.5.0), but `outdated` sees 0.8.0 as the
			// available upstream without needing to re-fetch the cache.
			// (Matches the pattern in install-version-change.test.ts that
			// works reliably under CI's Linux+Bun matrix; the post-install
			// addTagToRepo + ensureCached re-fetch sequence flakes there.)
			await addTagToRepo(repoDir, bareDir, "v0.8.0", [
				{ path: "skills/exp", name: "exp" },
				{ path: "skills/tut", name: "tut" },
			]);

			await writeManifest(
				dir,
				`dependencies:
  exp:
    repo: "file://${bareDir}"
    path: skills/exp
    version: "*"
  tut:
    repo: "file://${bareDir}"
    path: skills/tut
    version: "^0.5.0"
`,
			);
			await installCommand(dir, {});

			const { logs, restore } = captureConsole();
			try {
				await outdatedCommand(dir, undefined, { json: true });
			} finally {
				restore();
			}

			const rows = JSON.parse(logs.join("")) as Array<Record<string, unknown>>;
			const expRow = rows.find((r) => r.name === "exp");
			const tutRow = rows.find((r) => r.name === "tut");

			expect(expRow?.latest).toBe("0.8.0");
			expect(expRow?.cappedBy).toEqual(["tut@^0.5.0"]);

			// tut's own constraint rejects 0.8.0, so the cap is self-imposed, not sibling.
			expect(tutRow?.cappedBy).toBeNull();
		});

		test("no annotation when latest satisfies all sibling constraints", async () => {
			const dir = await makeTempDir();
			const repoDir = await createTestRepo(
				dir,
				"repo",
				[
					{ path: "skills/a", name: "a" },
					{ path: "skills/b", name: "b" },
				],
				"v1.0.0",
			);
			const bareDir = await makeBareClone(repoDir, dir, "bare");

			await writeManifest(
				dir,
				`dependencies:
  a:
    repo: "file://${bareDir}"
    path: skills/a
    version: "*"
  b:
    repo: "file://${bareDir}"
    path: skills/b
    version: "*"
`,
			);
			await installCommand(dir, {});
			await addTagToRepo(repoDir, bareDir, "v2.0.0", [
				{ path: "skills/a", name: "a" },
				{ path: "skills/b", name: "b" },
			]);

			const { logs, restore } = captureConsole();
			try {
				await outdatedCommand(dir, undefined, { json: true });
			} finally {
				restore();
			}

			const rows = JSON.parse(logs.join("")) as Array<Record<string, unknown>>;
			for (const row of rows) {
				expect(row.cappedBy).toBeNull();
			}
		});

		test("siblings in different repos do not cross-cap", async () => {
			const dir = await makeTempDir();
			const repoA = await createTestRepo(dir, "repoA", [{ path: "skills/a", name: "a" }], "v0.5.0");
			const repoB = await createTestRepo(dir, "repoB", [{ path: "skills/b", name: "b" }], "v0.5.0");
			const bareA = await makeBareClone(repoA, dir, "bareA");
			const bareB = await makeBareClone(repoB, dir, "bareB");

			await writeManifest(
				dir,
				`dependencies:
  a:
    repo: "file://${bareA}"
    path: skills/a
    version: "*"
  b:
    repo: "file://${bareB}"
    path: skills/b
    version: "^0.5.0"
`,
			);
			await installCommand(dir, {});
			await addTagToRepo(repoA, bareA, "v0.8.0", [{ path: "skills/a", name: "a" }]);

			const { logs, restore } = captureConsole();
			try {
				await outdatedCommand(dir, undefined, { json: true });
			} finally {
				restore();
			}

			const rows = JSON.parse(logs.join("")) as Array<Record<string, unknown>>;
			// 'a' is in repoA only; 'b' is in repoB — b's constraint must not cap a.
			const aRow = rows.find((r) => r.name === "a");
			expect(aRow?.cappedBy).toBeNull();
		});

		test("table output renders 'capped by' note", async () => {
			const dir = await makeTempDir();
			const repoDir = await createTestRepo(
				dir,
				"repo",
				[
					{ path: "skills/exp", name: "exp" },
					{ path: "skills/tut", name: "tut" },
				],
				"v0.5.0",
			);
			const bareDir = await makeBareClone(repoDir, dir, "bare");
			// See sibling-cap test above for why v0.8.0 is tagged pre-install.
			await addTagToRepo(repoDir, bareDir, "v0.8.0", [
				{ path: "skills/exp", name: "exp" },
				{ path: "skills/tut", name: "tut" },
			]);

			await writeManifest(
				dir,
				`dependencies:
  exp:
    repo: "file://${bareDir}"
    path: skills/exp
    version: "*"
  tut:
    repo: "file://${bareDir}"
    path: skills/tut
    version: "^0.5.0"
`,
			);
			await installCommand(dir, {});

			const { logs, restore } = captureConsole();
			try {
				await outdatedCommand(dir, undefined, {});
			} finally {
				restore();
			}

			const out = logs.join("\n");
			expect(out).toContain("capped by tut@^0.5.0");
		});
	});
});
