import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { teachCommand } from "../../src/commands/teach.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(tmpdir(), `skilltree-teach-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	await mkdir(tempDir, { recursive: true });
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("teachCommand", () => {
	test("installs skill files to target directory", async () => {
		const dir = await setup();
		await teachCommand(dir);

		const skillMd = join(dir, "skills", "skilltree", "SKILL.md");
		expect(existsSync(skillMd)).toBe(true);

		const content = await readFile(skillMd, "utf-8");
		expect(content).toContain("name: skilltree");
	});

	test("installs references alongside SKILL.md", async () => {
		const dir = await setup();
		await teachCommand(dir);

		expect(existsSync(join(dir, "skills", "skilltree", "references", "commands.md"))).toBe(true);
		expect(existsSync(join(dir, "skills", "skilltree", "references", "workflows.md"))).toBe(true);
	});

	test("prints completion hint in output", async () => {
		const dir = await setup();

		const logs: string[] = [];
		const orig = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await teachCommand(dir);
		} finally {
			console.log = orig;
		}

		const output = logs.join("\n");
		expect(output).toContain("completion");
		expect(output).toContain("zsh");
	});

	test("overwrites existing skill on re-run", async () => {
		const dir = await setup();
		await teachCommand(dir);
		// Should not throw on second run
		await teachCommand(dir);

		const skillMd = join(dir, "skills", "skilltree", "SKILL.md");
		expect(existsSync(skillMd)).toBe(true);
	});
});
