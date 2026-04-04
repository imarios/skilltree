import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanCommand } from "../../src/commands/scan.js";

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
		expect(logs.some((l) => l.includes("All skill references are declared"))).toBe(true);
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
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		process.exit = ((code: number) => {
			exitCode = code;
			throw new Error(`exit ${code}`);
		}) as any;

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
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		process.exit = (() => {
			exitCalled = true;
		}) as any;

		try {
			await scanCommand([join(dir, "my-skill")], { check: true });
			expect(exitCalled).toBe(false);
		} finally {
			process.exit = originalExit;
		}
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
});
