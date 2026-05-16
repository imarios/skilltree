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
	test("creates skilltree.yml with project name from directory", async () => {
		const dir = await makeTempDir();
		// Create a fake home with no agents — should default to claude
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });
		await initCommand(dir, { homeDir: fakeHome });

		const content = await readFile(join(dir, "skilltree.yml"), "utf-8");
		expect(content).toContain("name:");
		expect(content).toContain("install_targets");
		expect(content).toContain("claude");
	});

	test("scaffolds a scan.ignore hint comment (issue #52)", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });
		await initCommand(dir, { homeDir: fakeHome });

		const content = await readFile(join(dir, "skilltree.yml"), "utf-8");
		// The hint advertises the field without activating it — keeps the
		// generated YAML lean while making the knob discoverable.
		expect(content).toContain("scan:");
		expect(content).toContain("ignore:");
		expect(content).toContain("my-internal-command");
		// Hint is a YAML comment, so the parsed manifest should still have no
		// `scan` field (i.e., commenting out, not activating).
		expect(content).toMatch(/^#\s*scan:/m);
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

	test("codex target writes .agents/ entries (not .codex/)", async () => {
		// Regression for #32: init was string-prefixing a dot to the target name
		// (".codex"), but the codex install dir is actually ".agents". The
		// resulting .gitignore protected the wrong directory and let installed
		// artifacts leak into git.
		const dir = await makeTempDir();
		const fakeHome = join(dir, "home");
		await mkdir(join(fakeHome, ".codex"), { recursive: true });

		await initCommand(dir, { homeDir: fakeHome });

		const content = await readFile(join(dir, ".gitignore"), "utf-8");
		expect(content).toContain(".agents/skills/");
		expect(content).toContain(".agents/agents/");
		expect(content).toContain(".agents/commands/");
		expect(content).not.toContain(".codex/skills/");
	});

	test("copilot target writes .github/ entries (not .copilot/)", async () => {
		// Regression for #32: same root cause — copilot's install dir is
		// ".github", but init was writing ".copilot/skills/" to gitignore.
		const dir = await makeTempDir();
		const fakeHome = join(dir, "home");
		await mkdir(join(fakeHome, ".copilot"), { recursive: true });

		await initCommand(dir, { homeDir: fakeHome });

		const content = await readFile(join(dir, ".gitignore"), "utf-8");
		expect(content).toContain(".github/skills/");
		expect(content).toContain(".github/agents/");
		expect(content).toContain(".github/commands/");
		expect(content).not.toContain(".copilot/skills/");
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

	test("refuses to overwrite existing skilltree.yml", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });
		await initCommand(dir, { homeDir: fakeHome });
		await expect(initCommand(dir, { homeDir: fakeHome })).rejects.toThrow("already exists");
	});

	test("error message names the actual existing file (.yaml, not .yml)", async () => {
		// Regression: init used to hardcode MANIFEST_NEW in the "already exists"
		// error, so a project on the legacy .yaml extension got told `.yml`
		// already existed when in fact `.yaml` did.
		const dir = await makeTempDir();
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });
		await writeFile(join(dir, "skilltree.yaml"), "name: legacy\ndependencies: {}\n");
		await expect(initCommand(dir, { homeDir: fakeHome })).rejects.toThrow(/skilltree\.yaml/);
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

	test("--scan with askFn drives the interactive prompt and prints the listing", async () => {
		// Exercises the prompt pipeline end-to-end (printDiscovered +
		// promptForSelection + parseSelectionAnswer) without touching stdin.
		const dir = await makeTempDir();
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });

		await mkdir(join(dir, "skills/alpha"), { recursive: true });
		await writeFile(join(dir, "skills/alpha/SKILL.md"), "---\nname: alpha\n---\n");
		await mkdir(join(dir, "skills/beta"), { recursive: true });
		await writeFile(join(dir, "skills/beta/SKILL.md"), "---\nname: beta\n---\n");
		await mkdir(join(dir, "agents"), { recursive: true });
		await writeFile(join(dir, "agents/inspector.md"), "---\nname: inspector\n---\n");

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (msg: string) => logs.push(msg);
		let askedQuestion = "";
		try {
			await initCommand(dir, {
				homeDir: fakeHome,
				scan: true,
				askFn: async (q) => {
					askedQuestion = q;
					return "1,3"; // pick indices 1 and 3 from the printed list
				},
			});
		} finally {
			console.log = originalLog;
		}

		expect(askedQuestion).toContain("Include all?");

		// Listing output captured: header, both sections, and per-entry lines.
		const joined = logs.join("\n");
		expect(joined).toContain("Found 2 skills and 1 agent");
		expect(joined).toContain("Skills:");
		expect(joined).toContain("Agents:");
		expect(joined).toContain("[1]");
		expect(joined).toContain("alpha");
		expect(joined).toContain("inspector");

		// Sort order is (type, name), so the printed list is:
		//   [1] inspector (agent)
		//   [2] alpha (skill)
		//   [3] beta (skill)
		// Picking "1,3" keeps inspector + beta.
		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.inspector).toBeDefined();
		expect(manifest.dependencies?.beta).toBeDefined();
		expect(manifest.dependencies?.alpha).toBeUndefined();
	});

	describe("--global", () => {
		test("creates a new global.yml when none exists", async () => {
			const dir = await makeTempDir();
			const globalDir = join(dir, "global-home");

			await initCommand(dir, { global: true, globalDir });

			const content = await readFile(join(globalDir, "global.yml"), "utf-8");
			expect(content).toContain("dependencies");
		});

		test("warning names the actual existing global file (.yaml, not .yml)", async () => {
			// Same regression as project init: --global used to hardcode
			// GLOBAL_MANIFEST in the message regardless of which file existed.
			const dir = await makeTempDir();
			const globalDir = join(dir, "global-home");
			await mkdir(globalDir, { recursive: true });
			await writeFile(join(globalDir, "global.yaml"), "dependencies: {}\n");

			const warnings: string[] = [];
			const originalWarn = console.warn;
			console.warn = (msg: string) => warnings.push(msg);
			try {
				await initCommand(dir, { global: true, globalDir });
			} finally {
				console.warn = originalWarn;
			}

			expect(warnings.some((w) => w.includes("global.yaml") && w.includes("already exists"))).toBe(
				true,
			);
		});

		test("warns and leaves the file untouched when global.yml already exists", async () => {
			const dir = await makeTempDir();
			const globalDir = join(dir, "global-home");
			await mkdir(globalDir, { recursive: true });
			const existing = "dependencies:\n  preexisting:\n    local: ./x\n";
			await writeFile(join(globalDir, "global.yml"), existing);

			const warnings: string[] = [];
			const originalWarn = console.warn;
			console.warn = (msg: string) => warnings.push(msg);
			try {
				await initCommand(dir, { global: true, globalDir });
			} finally {
				console.warn = originalWarn;
			}

			expect(warnings.some((w) => w.includes("already exists"))).toBe(true);
			// File must be byte-for-byte unchanged — no clobber of the user's deps.
			const after = await readFile(join(globalDir, "global.yml"), "utf-8");
			expect(after).toBe(existing);
		});
	});

	test("--scan in non-interactive context (no --yes, no selectFn) defaults to include-all", async () => {
		// Simulates CI: non-TTY stdout, no selector, no askFn. The command must
		// not hang on readline. Passing isInteractive: false explicitly so the
		// test's outcome doesn't depend on whether the test runner's stdout
		// happens to be a TTY (it is when run via `make test` from a shell).
		const dir = await makeTempDir();
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });

		await mkdir(join(dir, "skills/only-one"), { recursive: true });
		await writeFile(join(dir, "skills/only-one/SKILL.md"), "---\nname: only-one\n---\n");

		await initCommand(dir, { homeDir: fakeHome, scan: true, isInteractive: false });

		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.["only-one"]).toBeDefined();
	});
});
