import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { teachCommand } from "../../src/commands/teach.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-teach-agents-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("teach auto-detection", () => {
	test("installs to single detected agent", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "home");
		await mkdir(join(fakeHome, ".codex"), { recursive: true });

		await teachCommand({ homeDir: fakeHome });

		const skillMd = join(fakeHome, ".codex", "skills", "skilltree", "SKILL.md");
		expect(existsSync(skillMd)).toBe(true);
	});

	test("installs to all detected agents by default", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "home");
		await mkdir(join(fakeHome, ".claude"), { recursive: true });
		await mkdir(join(fakeHome, ".codex"), { recursive: true });

		await teachCommand({ homeDir: fakeHome });

		expect(existsSync(join(fakeHome, ".claude", "skills", "skilltree", "SKILL.md"))).toBe(true);
		expect(existsSync(join(fakeHome, ".codex", "skills", "skilltree", "SKILL.md"))).toBe(true);
	});

	test("--agent restricts to specific agent", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "home");
		await mkdir(join(fakeHome, ".claude"), { recursive: true });
		await mkdir(join(fakeHome, ".codex"), { recursive: true });

		await teachCommand({ homeDir: fakeHome, agent: "claude" });

		expect(existsSync(join(fakeHome, ".claude", "skills", "skilltree", "SKILL.md"))).toBe(true);
		expect(existsSync(join(fakeHome, ".codex", "skills", "skilltree", "SKILL.md"))).toBe(false);
	});

	test("errors when no agents detected", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });

		await expect(teachCommand({ homeDir: fakeHome })).rejects.toThrow("no agents detected");
	});
});
