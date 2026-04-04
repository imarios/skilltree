import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCommand } from "../../src/commands/init.js";

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
		await initCommand(dir);

		const content = await readFile(join(dir, "skilltree.yaml"), "utf-8");
		expect(content).toContain("name:");
		expect(content).toContain("install_path: .claude");
	});

	test("creates .gitignore with skill and agent entries", async () => {
		const dir = await makeTempDir();
		await initCommand(dir);

		const content = await readFile(join(dir, ".gitignore"), "utf-8");
		expect(content).toContain(".claude/skills/");
		expect(content).toContain(".claude/agents/");
	});

	test("appends to existing .gitignore without duplicating entries", async () => {
		const dir = await makeTempDir();
		const { writeFile } = await import("node:fs/promises");
		await writeFile(join(dir, ".gitignore"), "node_modules/\n.claude/skills/\n");

		await initCommand(dir);

		const content = await readFile(join(dir, ".gitignore"), "utf-8");
		const skillMatches = content.match(/\.claude\/skills\//g);
		expect(skillMatches?.length).toBe(1);
		expect(content).toContain(".claude/agents/");
	});

	test("refuses to overwrite existing skilltree.yaml", async () => {
		const dir = await makeTempDir();
		await initCommand(dir);
		await expect(initCommand(dir)).rejects.toThrow("already exists");
	});
});
