import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCommand, parseSelectionAnswer } from "../../src/commands/init.js";
import { readManifest } from "../../src/core/manifest.js";
import type { LocalEntry } from "../../src/core/repo-scanner.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-init-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("initCommand", () => {
	test("creates skilltree.yaml with project name from directory", async () => {
		const dir = await makeTempDir();
		// Create a fake home with no agents — should default to claude
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });
		await initCommand(dir, { homeDir: fakeHome });

		const content = await readFile(join(dir, "skilltree.yaml"), "utf-8");
		expect(content).toContain("name:");
		expect(content).toContain("install_targets");
		expect(content).toContain("claude");
	});

	test("creates .gitignore with skill and agent entries", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });
		await initCommand(dir, { homeDir: fakeHome });

		const content = await readFile(join(dir, ".gitignore"), "utf-8");
		expect(content).toContain(".claude/skills/");
		expect(content).toContain(".claude/agents/");
	});

	test("appends to existing .gitignore without duplicating entries", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });
		const { writeFile } = await import("node:fs/promises");
		await writeFile(join(dir, ".gitignore"), "node_modules/\n.claude/skills/\n");

		await initCommand(dir, { homeDir: fakeHome });

		const content = await readFile(join(dir, ".gitignore"), "utf-8");
		const skillMatches = content.match(/\.claude\/skills\//g);
		expect(skillMatches?.length).toBe(1);
		expect(content).toContain(".claude/agents/");
	});

	test("refuses to overwrite existing skilltree.yaml", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });
		await initCommand(dir, { homeDir: fakeHome });
		await expect(initCommand(dir, { homeDir: fakeHome })).rejects.toThrow("already exists");
	});

	test("--scan with --yes registers discovered skills and agents as local deps", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });

		// Seed the repo with a skill and an agent.
		await mkdir(join(dir, "skills/my-skill"), { recursive: true });
		await writeFile(
			join(dir, "skills/my-skill/SKILL.md"),
			"---\nname: my-skill\ndescription: A fine skill\n---\n",
		);
		await mkdir(join(dir, "agents"), { recursive: true });
		await writeFile(
			join(dir, "agents/code-reviewer.md"),
			"---\nname: code-reviewer\ndescription: Reviews code\n---\n",
		);

		await initCommand(dir, { homeDir: fakeHome, scan: true, yes: true });

		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.["my-skill"]).toEqual({
			local: "./skills/my-skill",
			type: "skill",
		});
		expect(manifest.dependencies?.["code-reviewer"]).toEqual({
			local: "./agents/code-reviewer.md",
			type: "agent",
		});
	});

	test("--scan without entries does not add dependencies", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });

		await initCommand(dir, { homeDir: fakeHome, scan: true, yes: true });

		const manifest = await readManifest(dir);
		expect(manifest.dependencies).toEqual({});
	});

	test("--scan with selectFn returning subset only registers chosen entries", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });

		await mkdir(join(dir, "skills/keep-me"), { recursive: true });
		await writeFile(join(dir, "skills/keep-me/SKILL.md"), "---\nname: keep-me\n---\n");
		await mkdir(join(dir, "skills/drop-me"), { recursive: true });
		await writeFile(join(dir, "skills/drop-me/SKILL.md"), "---\nname: drop-me\n---\n");

		await initCommand(dir, {
			homeDir: fakeHome,
			scan: true,
			// Select only the first entry (sorted by type, name → "drop-me, keep-me")
			// Actually the test should not depend on sort order — filter explicitly.
			selectFn: async (found) => found.filter((f) => f.name === "keep-me"),
		});

		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.["keep-me"]).toBeDefined();
		expect(manifest.dependencies?.["drop-me"]).toBeUndefined();
	});

	describe("parseSelectionAnswer", () => {
		const sample: LocalEntry[] = [
			{ name: "a", type: "skill", path: "skills/a" },
			{ name: "b", type: "skill", path: "skills/b" },
			{ name: "c", type: "agent", path: "agents/c.md" },
		];

		const cases: Array<[string, string[]]> = [
			["", ["a", "b", "c"]],
			["y", ["a", "b", "c"]],
			["Y", ["a", "b", "c"]],
			["n", []],
			["N", []],
			["1", ["a"]],
			["1,3", ["a", "c"]],
			["1, 3", ["a", "c"]],
			["3,1", ["c", "a"]],
			["1,1,2", ["a", "b"]], // duplicates collapsed, original order preserved
			["99", []], // out-of-range ignored
			["1,99,2", ["a", "b"]], // mixed in/out-of-range → valid ones kept
			["garbage", []],
		];

		for (const [input, expectedNames] of cases) {
			test(`"${input}" → [${expectedNames.join(", ")}]`, () => {
				const picked = parseSelectionAnswer(input, sample);
				expect(picked.map((e) => e.name)).toEqual(expectedNames);
			});
		}
	});

	test("--scan without --yes and no tty/selectFn defaults to include-all", async () => {
		// This mirrors the CI/non-interactive path: if stdout is not a TTY
		// and no selector is provided, `init --scan` should not hang on
		// readline. Since Bun's test stdout is not a TTY, calling without
		// selectFn / yes exercises the fallback.
		const dir = await makeTempDir();
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });

		await mkdir(join(dir, "skills/only-one"), { recursive: true });
		await writeFile(join(dir, "skills/only-one/SKILL.md"), "---\nname: only-one\n---\n");

		await initCommand(dir, { homeDir: fakeHome, scan: true });

		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.["only-one"]).toBeDefined();
	});
});
