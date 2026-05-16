import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { indexCommand } from "../../src/commands/index-cmd.js";
import { _resetDeprecationWarningsForTests } from "../../src/core/filenames.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

beforeEach(() => {
	_resetDeprecationWarningsForTests();
});

function captureWarnings(): { warnings: string[]; restore: () => void } {
	const warnings: string[] = [];
	const original = console.warn;
	console.warn = (msg: string) => {
		warnings.push(msg);
	};
	return { warnings, restore: () => (console.warn = original) };
}

function runExpectingExit(fn: () => Promise<void>): Promise<number | undefined> {
	let captured: number | undefined;
	const originalExit = process.exit;
	process.exit = ((c: number) => {
		captured = c;
		throw new Error(`exit ${c}`);
	}) as typeof process.exit;
	return fn()
		.catch(() => {
			// Expected — exit mock throws
		})
		.finally(() => {
			process.exit = originalExit;
		})
		.then(() => captured);
}

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-index-cmd-"));
	return tempDir;
}

describe("indexCommand", () => {
	test("generates skilltree-index.yml for skills", async () => {
		const dir = await makeTempDir();
		const skillDir = join(dir, "skills", "my-skill");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			"---\nname: my-skill\ndescription: A test skill\n---\n\n# My Skill\n",
		);

		await indexCommand({}, dir);

		const indexPath = join(dir, "skilltree-index.yml");
		expect(existsSync(indexPath)).toBe(true);

		const content = await readFile(indexPath, "utf-8");
		const parsed = YAML.parse(content);
		expect(parsed.entities).toHaveLength(1);
		expect(parsed.entities[0].name).toBe("my-skill");
		expect(parsed.entities[0].type).toBe("skill");
		expect(parsed.entities[0].description).toBe("A test skill");
	});

	test("generates index for agents (.md files with frontmatter)", async () => {
		const dir = await makeTempDir();
		const agentDir = join(dir, "agents");
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			join(agentDir, "my-agent.md"),
			"---\nname: my-agent\ndescription: A test agent\n---\n\n# My Agent\n",
		);

		await indexCommand({}, dir);

		const content = await readFile(join(dir, "skilltree-index.yml"), "utf-8");
		const parsed = YAML.parse(content);
		expect(parsed.entities.some((e: { name: string }) => e.name === "my-agent")).toBe(true);
	});

	test("skips hidden directories and node_modules", async () => {
		const dir = await makeTempDir();

		// Skill in hidden dir — should be skipped
		await mkdir(join(dir, ".hidden", "skills", "bad-skill"), { recursive: true });
		await writeFile(
			join(dir, ".hidden", "skills", "bad-skill", "SKILL.md"),
			"---\nname: bad-skill\n---\n",
		);

		// Skill in node_modules — should be skipped
		await mkdir(join(dir, "node_modules", "skills", "nm-skill"), { recursive: true });
		await writeFile(
			join(dir, "node_modules", "skills", "nm-skill", "SKILL.md"),
			"---\nname: nm-skill\n---\n",
		);

		// Valid skill
		await mkdir(join(dir, "skills", "good-skill"), { recursive: true });
		await writeFile(join(dir, "skills", "good-skill", "SKILL.md"), "---\nname: good-skill\n---\n");

		await indexCommand({}, dir);

		const content = await readFile(join(dir, "skilltree-index.yml"), "utf-8");
		const parsed = YAML.parse(content);
		expect(parsed.entities).toHaveLength(1);
		expect(parsed.entities[0].name).toBe("good-skill");
	});

	test("skips common non-entity .md files (README, CHANGELOG, etc.)", async () => {
		const dir = await makeTempDir();
		await writeFile(join(dir, "README.md"), "# Readme\n");
		await writeFile(join(dir, "CHANGELOG.md"), "# Changelog\n");

		// Valid skill
		await mkdir(join(dir, "skills", "real-skill"), { recursive: true });
		await writeFile(join(dir, "skills", "real-skill", "SKILL.md"), "---\nname: real-skill\n---\n");

		await indexCommand({}, dir);

		const content = await readFile(join(dir, "skilltree-index.yml"), "utf-8");
		const parsed = YAML.parse(content);
		expect(parsed.entities).toHaveLength(1);
		expect(parsed.entities[0].name).toBe("real-skill");
	});

	test("does not recurse into skill directories", async () => {
		const dir = await makeTempDir();
		// Skill with a references subdirectory containing .md files
		await mkdir(join(dir, "skills", "my-skill", "references"), { recursive: true });
		await writeFile(join(dir, "skills", "my-skill", "SKILL.md"), "---\nname: my-skill\n---\n");
		await writeFile(join(dir, "skills", "my-skill", "references", "ref.md"), "# Reference\n");

		await indexCommand({}, dir);

		const content = await readFile(join(dir, "skilltree-index.yml"), "utf-8");
		const parsed = YAML.parse(content);
		// Should only find the skill, not the reference file as an agent
		expect(parsed.entities).toHaveLength(1);
		expect(parsed.entities[0].name).toBe("my-skill");
	});

	test("--check exits 0 when index is up to date", async () => {
		const dir = await makeTempDir();
		await mkdir(join(dir, "skills", "my-skill"), { recursive: true });
		await writeFile(join(dir, "skills", "my-skill", "SKILL.md"), "---\nname: my-skill\n---\n");

		// Generate index first
		await indexCommand({}, dir);

		// Check should pass
		await indexCommand({ check: true }, dir);
	});

	test("--check exits 1 when index is stale", async () => {
		const dir = await makeTempDir();
		await mkdir(join(dir, "skills", "my-skill"), { recursive: true });
		await writeFile(join(dir, "skills", "my-skill", "SKILL.md"), "---\nname: my-skill\n---\n");

		// Generate index
		await indexCommand({}, dir);

		// Add a new skill
		await mkdir(join(dir, "skills", "new-skill"), { recursive: true });
		await writeFile(join(dir, "skills", "new-skill", "SKILL.md"), "---\nname: new-skill\n---\n");

		let exitCode: number | undefined;
		const originalExit = process.exit;
		process.exit = ((code: number) => {
			exitCode = code;
			throw new Error(`exit ${code}`);
		}) as typeof process.exit;
		try {
			await indexCommand({ check: true }, dir);
		} catch {
			// Expected — our mock throws to stop execution
		} finally {
			process.exit = originalExit;
		}
		expect(exitCode).toBe(1);
	});

	test("--check exits 1 when no index exists", async () => {
		const dir = await makeTempDir();
		await mkdir(join(dir, "skills", "my-skill"), { recursive: true });
		await writeFile(join(dir, "skills", "my-skill", "SKILL.md"), "---\nname: my-skill\n---\n");

		let exitCode: number | undefined;
		const originalExit = process.exit;
		process.exit = ((code: number) => {
			exitCode = code;
			throw new Error(`exit ${code}`);
		}) as typeof process.exit;
		try {
			await indexCommand({ check: true }, dir);
		} catch {
			// Expected — our mock throws to stop execution
		} finally {
			process.exit = originalExit;
		}
		expect(exitCode).toBe(1);
	});

	test("mixed skills and agents in nested directories", async () => {
		const dir = await makeTempDir();
		await mkdir(join(dir, "skills", "alpha"), { recursive: true });
		await writeFile(join(dir, "skills", "alpha", "SKILL.md"), "---\nname: alpha\n---\n");

		await mkdir(join(dir, "agents"), { recursive: true });
		await writeFile(
			join(dir, "agents", "beta.md"),
			"---\nname: beta\nskills: alpha\n---\n\n# Beta Agent\n",
		);

		await indexCommand({}, dir);

		const content = await readFile(join(dir, "skilltree-index.yml"), "utf-8");
		const parsed = YAML.parse(content);
		expect(parsed.entities).toHaveLength(2);
		const names = parsed.entities.map((e: { name: string }) => e.name).sort();
		expect(names).toEqual(["alpha", "beta"]);
	});

	test("write replaces a legacy skillkit-index.yaml with the new file", async () => {
		const dir = await makeTempDir();
		await mkdir(join(dir, "skills", "my-skill"), { recursive: true });
		await writeFile(join(dir, "skills", "my-skill", "SKILL.md"), "---\nname: my-skill\n---\n");
		// Pre-existing legacy file from an older skilltree version
		await writeFile(join(dir, "skillkit-index.yaml"), "entities: []\n");

		await indexCommand({}, dir);

		expect(existsSync(join(dir, "skilltree-index.yml"))).toBe(true);
		expect(existsSync(join(dir, "skillkit-index.yaml"))).toBe(false);
	});

	test("--check exits 1 with a deprecation warning when only the legacy file exists", async () => {
		const dir = await makeTempDir();
		await mkdir(join(dir, "skills", "my-skill"), { recursive: true });
		await writeFile(join(dir, "skills", "my-skill", "SKILL.md"), "---\nname: my-skill\n---\n");
		await writeFile(
			join(dir, "skillkit-index.yaml"),
			YAML.stringify({
				entities: [{ name: "my-skill", type: "skill", path: "skills/my-skill" }],
			}),
		);

		const { warnings, restore } = captureWarnings();
		let exitCode: number | undefined;
		try {
			exitCode = await runExpectingExit(() => indexCommand({ check: true }, dir));
		} finally {
			restore();
		}
		expect(exitCode).toBe(1);
		expect(warnings.some((w) => /skillkit-index\.yaml/.test(w))).toBe(true);
		expect(warnings.some((w) => /skilltree registry index/.test(w))).toBe(true);
	});

	test("--check errors when both new and legacy index files exist", async () => {
		const dir = await makeTempDir();
		await writeFile(join(dir, "skilltree-index.yml"), "entities: []\n");
		await writeFile(join(dir, "skillkit-index.yaml"), "entities: []\n");

		await expect(indexCommand({ check: true }, dir)).rejects.toThrow(
			/Both skilltree-index\.yml and skillkit-index\.yaml/,
		);
	});

	// --- Issue #62: --check must respect hand-authored entries for skills at
	// non-standard paths (the scanner only walks the standard layout). ---

	test("--check passes when index contains a hand-authored entry for a skill at a non-standard path", async () => {
		const dir = await makeTempDir();

		// Standard-layout skill — scanner-discoverable
		await mkdir(join(dir, "crawl4ai"), { recursive: true });
		await writeFile(join(dir, "crawl4ai", "SKILL.md"), "---\nname: crawl4ai\n---\n");

		// Outer "esql-details" is itself a skill — scanner-discoverable. Since
		// the scanner stops at the first SKILL.md and does not recurse into
		// skill directories, the nested skill below is unreachable to it.
		await mkdir(join(dir, "esql-details", "esql-details-inner"), { recursive: true });
		await writeFile(join(dir, "esql-details", "SKILL.md"), "---\nname: esql-details\n---\n");
		await writeFile(
			join(dir, "esql-details", "esql-details-inner", "SKILL.md"),
			"---\nname: esql-details-inner\n---\n",
		);

		// Hand-authored index that includes all three — the third one is the
		// manual addition for the non-standard, scanner-unreachable path.
		await writeFile(
			join(dir, "skilltree-index.yml"),
			YAML.stringify({
				entities: [
					{ name: "crawl4ai", type: "skill", path: "crawl4ai" },
					{ name: "esql-details", type: "skill", path: "esql-details" },
					{
						name: "esql-details-inner",
						type: "skill",
						path: "esql-details/esql-details-inner",
					},
				],
			}),
		);

		const exitCode = await runExpectingExit(() => indexCommand({ check: true }, dir));
		expect(exitCode).toBeUndefined();
	});

	test("--check passes when index contains a hand-authored entry for an agent at a non-standard path", async () => {
		const dir = await makeTempDir();

		// Nested agent that the scanner won't reach because it lives inside a
		// directory that the scanner doesn't conventionally walk into.
		await mkdir(join(dir, "custom", "nested"), { recursive: true });
		await writeFile(
			join(dir, "custom", "nested", "deep-agent.md"),
			"---\nname: deep-agent\nskills: foo\n---\n",
		);

		// Tell the scanner not to recurse into `custom/` by placing a SKILL.md
		// at `custom/` (skills are not recursed into), so the agent stays
		// scanner-invisible while still existing on disk.
		await writeFile(join(dir, "custom", "SKILL.md"), "---\nname: custom-skill\n---\n");

		await writeFile(
			join(dir, "skilltree-index.yml"),
			YAML.stringify({
				entities: [
					{ name: "custom-skill", type: "skill", path: "custom" },
					{
						name: "deep-agent",
						type: "agent",
						path: "custom/nested/deep-agent.md",
					},
				],
			}),
		);

		const exitCode = await runExpectingExit(() => indexCommand({ check: true }, dir));
		expect(exitCode).toBeUndefined();
	});

	test("--check fails when a hand-authored entry points to a non-existent path", async () => {
		const dir = await makeTempDir();
		await mkdir(join(dir, "real-skill"), { recursive: true });
		await writeFile(join(dir, "real-skill", "SKILL.md"), "---\nname: real-skill\n---\n");

		await writeFile(
			join(dir, "skilltree-index.yml"),
			YAML.stringify({
				entities: [
					{ name: "real-skill", type: "skill", path: "real-skill" },
					{ name: "phantom", type: "skill", path: "does/not/exist" },
				],
			}),
		);

		const exitCode = await runExpectingExit(() => indexCommand({ check: true }, dir));
		expect(exitCode).toBe(1);
	});

	test("--check fails when a scanner-discoverable entity is missing from the index", async () => {
		const dir = await makeTempDir();
		await mkdir(join(dir, "alpha"), { recursive: true });
		await writeFile(join(dir, "alpha", "SKILL.md"), "---\nname: alpha\n---\n");
		await mkdir(join(dir, "beta"), { recursive: true });
		await writeFile(join(dir, "beta", "SKILL.md"), "---\nname: beta\n---\n");

		// Index lists only one of the two — `beta` is missing.
		await writeFile(
			join(dir, "skilltree-index.yml"),
			YAML.stringify({
				entities: [{ name: "alpha", type: "skill", path: "alpha" }],
			}),
		);

		const exitCode = await runExpectingExit(() => indexCommand({ check: true }, dir));
		expect(exitCode).toBe(1);
	});

	test("--check preserves hand-authored tags on scanner-discoverable entries", async () => {
		const dir = await makeTempDir();
		await mkdir(join(dir, "my-skill"), { recursive: true });
		await writeFile(
			join(dir, "my-skill", "SKILL.md"),
			"---\nname: my-skill\ndescription: A test\n---\n",
		);

		// Scanner never produces `tags`. Hand-curated tags on an otherwise
		// scanner-equivalent entry must NOT trip --check.
		await writeFile(
			join(dir, "skilltree-index.yml"),
			YAML.stringify({
				entities: [
					{
						name: "my-skill",
						type: "skill",
						path: "my-skill",
						description: "A test",
						tags: ["custom", "curated"],
					},
				],
			}),
		);

		const exitCode = await runExpectingExit(() => indexCommand({ check: true }, dir));
		expect(exitCode).toBeUndefined();
	});

	test("--check fails when a scanner-discoverable entry has a wrong description", async () => {
		const dir = await makeTempDir();
		await mkdir(join(dir, "my-skill"), { recursive: true });
		await writeFile(
			join(dir, "my-skill", "SKILL.md"),
			"---\nname: my-skill\ndescription: Real description\n---\n",
		);

		await writeFile(
			join(dir, "skilltree-index.yml"),
			YAML.stringify({
				entities: [
					{
						name: "my-skill",
						type: "skill",
						path: "my-skill",
						description: "Outdated description",
					},
				],
			}),
		);

		const exitCode = await runExpectingExit(() => indexCommand({ check: true }, dir));
		expect(exitCode).toBe(1);
	});
});
