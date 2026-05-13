import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyEntityFile, scanCommand } from "../../src/commands/scan.js";
import type { EntityType } from "../../src/types.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-scan-cmd-"));
	return tempDir;
}

async function createSkill(
	dir: string,
	name: string,
	deps: string[],
	body: string,
): Promise<string> {
	const skillDir = join(dir, name);
	await mkdir(skillDir, { recursive: true });
	const depsYaml =
		deps.length > 0 ? `dependencies:\n${deps.map((d) => `  - ${d}`).join("\n")}` : "";
	await writeFile(join(skillDir, "SKILL.md"), `---\nname: ${name}\n${depsYaml}\n---\n\n${body}\n`);
	return skillDir;
}

function captureConsole(): { logs: string[]; restore: () => void } {
	const logs: string[] = [];
	const originalLog = console.log;
	console.log = (...args: unknown[]) => logs.push(args.join(" "));
	return { logs, restore: () => (console.log = originalLog) };
}

describe("scanCommand", () => {
	test("reports no files found for empty directory", async () => {
		const dir = await makeTempDir();
		const { logs, restore } = captureConsole();
		try {
			await scanCommand([dir], {});
		} finally {
			restore();
		}
		expect(logs.some((l) => l.includes("No .md files found"))).toBe(true);
	});

	test("detects undeclared dependency in body text", async () => {
		const dir = await makeTempDir();
		await createSkill(dir, "my-skill", [], "Use the `testing` skill for coverage.");

		const { logs, restore } = captureConsole();
		try {
			await scanCommand([join(dir, "my-skill")], {});
		} finally {
			restore();
		}
		expect(logs.some((l) => l.includes("testing"))).toBe(true);
	});

	test("reports all declared when no gaps", async () => {
		const dir = await makeTempDir();
		await createSkill(dir, "my-skill", ["testing"], "Use the `testing` skill for coverage.");

		const { logs, restore } = captureConsole();
		try {
			await scanCommand([join(dir, "my-skill")], {});
		} finally {
			restore();
		}
		expect(logs.some((l) => l.includes("All entity references are declared"))).toBe(true);
	});

	test("--json outputs JSON array", async () => {
		const dir = await makeTempDir();
		await createSkill(dir, "my-skill", [], "Use the `testing` skill.");

		const { logs, restore } = captureConsole();
		try {
			await scanCommand([join(dir, "my-skill")], { json: true });
		} finally {
			restore();
		}
		const json = JSON.parse(logs.join(""));
		expect(Array.isArray(json)).toBe(true);
		expect(json[0].undeclared).toContain("testing");
	});

	test("--check exits 1 when gaps found", async () => {
		const dir = await makeTempDir();
		await createSkill(dir, "my-skill", [], "Use the `testing` skill.");

		let exitCode: number | undefined;
		const originalExit = process.exit;
		process.exit = ((code: number) => {
			exitCode = code;
			throw new Error(`exit ${code}`);
		}) as typeof process.exit;

		try {
			await scanCommand([join(dir, "my-skill")], { check: true });
		} catch {
			// Expected — our mock throws to stop execution
		} finally {
			process.exit = originalExit;
		}
		expect(exitCode).toBe(1);
	});

	test("--check does not exit when no gaps", async () => {
		const dir = await makeTempDir();
		await createSkill(dir, "my-skill", ["testing"], "Use the `testing` skill.");

		let exitCalled = false;
		const originalExit = process.exit;
		process.exit = (() => {
			exitCalled = true;
		}) as typeof process.exit;

		try {
			await scanCommand([join(dir, "my-skill")], { check: true });
			expect(exitCalled).toBe(false);
		} finally {
			process.exit = originalExit;
		}
	});

	test("--check exits 1 when only XML-form Skill references are present (issue #34)", async () => {
		// Regression for #34: `<Skill name="..."/>` content used to slip past
		// the regex scanner, giving false-confidence green from --check.
		const dir = await makeTempDir();
		await createSkill(dir, "my-skill", [], 'See <Skill name="docker-dev"/> for setup.');

		let exitCode: number | undefined;
		const originalExit = process.exit;
		process.exit = ((code: number) => {
			exitCode = code;
			throw new Error(`exit ${code}`);
		}) as typeof process.exit;

		try {
			await scanCommand([join(dir, "my-skill")], { check: true });
		} catch {
			// Expected — our mock throws to stop execution
		} finally {
			process.exit = originalExit;
		}
		expect(exitCode).toBe(1);
	});

	test("--apply updates frontmatter with undeclared deps", async () => {
		const dir = await makeTempDir();
		const skillDir = await createSkill(dir, "my-skill", [], "Use the `testing` skill.");

		await scanCommand([skillDir], { apply: true });

		const { readFile } = await import("node:fs/promises");
		const content = await readFile(join(skillDir, "SKILL.md"), "utf-8");
		expect(content).toContain("testing");
		expect(content).toContain("dependencies:");
	});

	test("recursively collects .md files from directory", async () => {
		const dir = await makeTempDir();
		await createSkill(dir, "skill-a", [], "Use the `linting` skill.");
		await createSkill(dir, "skill-b", ["linting"], "Use the `linting` skill.");

		const { logs, restore } = captureConsole();
		try {
			await scanCommand([dir], {});
		} finally {
			restore();
		}
		// skill-a should show undeclared linting, skill-b should be clean
		expect(logs.some((l) => l.includes("skill-a"))).toBe(true);
	});

	test("handles single file path", async () => {
		const dir = await makeTempDir();
		await createSkill(dir, "my-skill", [], "Use the `testing` skill.");

		const { logs, restore } = captureConsole();
		try {
			await scanCommand([join(dir, "my-skill", "SKILL.md")], {});
		} finally {
			restore();
		}
		expect(logs.some((l) => l.includes("testing"))).toBe(true);
	});

	test("scan.ignore from skilltree.yml suppresses undeclared report (issue #52)", async () => {
		const dir = await makeTempDir();
		await createSkill(dir, "my-skill", [], "Use /my-internal-command and the /other-skill.");
		await writeFile(
			join(dir, "skilltree.yml"),
			[
				"name: test-project",
				"scan:",
				"  ignore:",
				"    - my-internal-command",
				"dependencies: {}",
				"",
			].join("\n"),
		);

		let exitCode: number | undefined;
		const originalExit = process.exit;
		const originalCwd = process.cwd();
		process.exit = ((code: number) => {
			exitCode = code;
			throw new Error(`exit ${code}`);
		}) as typeof process.exit;
		process.chdir(dir);

		const { logs, restore } = captureConsole();
		try {
			await scanCommand([join(dir, "my-skill")], { check: true });
		} catch {
			// Expected — mock throws to stop execution
		} finally {
			restore();
			process.exit = originalExit;
			process.chdir(originalCwd);
		}

		// other-skill is still undeclared and triggers exit 1
		expect(exitCode).toBe(1);
		const joined = logs.join("\n");
		expect(joined).toContain("other-skill");
		expect(joined).not.toContain("my-internal-command");
	});

	test("--llm path honors scan.ignore (issue #52)", async () => {
		// Mock the LLM module so we don't need ANTHROPIC_API_KEY in CI. The mock
		// returns both an ignored name and a real undeclared dep — the test
		// proves the ignore set filters LLM suggestions just like it does regex
		// matches, keeping the two stages in agreement. We preserve the rest of
		// the real exports (notably `parseEntityList`) so other test files that
		// share the module graph aren't affected.
		const realLlm = await import("../../src/core/llm.js");
		mock.module("../../src/core/llm.js", () => ({
			...realLlm,
			llmScanContent: async () => [
				{ name: "my-internal-command", type: "command" },
				{ name: "real-dep", type: "skill" },
			],
		}));

		const dir = await makeTempDir();
		await createSkill(dir, "my-skill", [], "Authoring body — content irrelevant under mock.");
		await writeFile(
			join(dir, "skilltree.yml"),
			[
				"name: test-project",
				"scan:",
				"  ignore:",
				"    - my-internal-command",
				"dependencies: {}",
				"",
			].join("\n"),
		);

		const originalCwd = process.cwd();
		process.chdir(dir);

		const { logs, restore } = captureConsole();
		try {
			await scanCommand([join(dir, "my-skill")], { llm: true, json: true });
		} finally {
			restore();
			process.chdir(originalCwd);
		}

		// JSON output captures the merged result; the ignored name must not
		// leak into either llmSuggestions or confirmed, while real-dep does.
		const jsonLine = logs.find((l) => l.trim().startsWith("["));
		expect(jsonLine).toBeDefined();
		const results = JSON.parse(jsonLine ?? "[]") as Array<{
			llmSuggestions?: string[];
			confirmed?: string[];
		}>;
		const merged = results.flatMap((r) => [...(r.llmSuggestions ?? []), ...(r.confirmed ?? [])]);
		expect(merged).not.toContain("my-internal-command");
		expect(merged).toContain("real-dep");
	});

	test("detects undeclared slash-command reference in a command file", async () => {
		const dir = await makeTempDir();
		const cmdDir = join(dir, "commands");
		await mkdir(cmdDir, { recursive: true });
		await writeFile(
			join(cmdDir, "code-refinement.md"),
			"---\ndescription: Iterate hypotheses\n---\n\nRun /hypothesis each round until clean.\n",
		);

		const { logs, restore } = captureConsole();
		try {
			await scanCommand([cmdDir], {});
		} finally {
			restore();
		}
		expect(logs.some((l) => l.includes("hypothesis"))).toBe(true);
	});
});

describe("classifyEntityFile", () => {
	// Parametrized: each row is [path, frontmatter name | undefined, expected].
	// Edge cases live next to canonical inputs so the matrix stays the single
	// source of truth — adding a new layout convention is one new row.
	const cases: Array<[string, string | undefined, { name: string; type: EntityType } | null]> = [
		// Skill: directory-based, name from declaring directory or frontmatter
		["skills/python-coding/SKILL.md", undefined, { name: "python-coding", type: "skill" }],
		[
			"/abs/path/skills/python-coding/SKILL.md",
			"python-coding",
			{ name: "python-coding", type: "skill" },
		],
		["skills/aliased-dir/SKILL.md", "real-name", { name: "real-name", type: "skill" }],

		// Command: under any commands/ segment, name from filename stem
		["commands/hypothesis.md", undefined, { name: "hypothesis", type: "command" }],
		["commands/hypothesis.md", "fm-named", { name: "fm-named", type: "command" }],
		[
			".claude/commands/code-refinement.md",
			undefined,
			{ name: "code-refinement", type: "command" },
		],
		["nested/commands/sub/foo.md", undefined, { name: "foo", type: "command" }],

		// Agent: single-file .md not under commands/, name from filename or frontmatter
		["agents/reviewer.md", undefined, { name: "reviewer", type: "agent" }],
		["agents/reviewer.md", "fm-named", { name: "fm-named", type: "agent" }],
		["loose-agent.md", undefined, { name: "loose-agent", type: "agent" }],
	];

	for (const [path, fmName, expected] of cases) {
		const fmDesc = fmName === undefined ? "no fm name" : `fm=${fmName}`;
		test(`${path} (${fmDesc}) → ${expected ? `${expected.type}:${expected.name}` : "null"}`, () => {
			expect(classifyEntityFile(path, fmName)).toEqual(expected);
		});
	}
});
