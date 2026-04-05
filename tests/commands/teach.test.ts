import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { teachCommand } from "../../src/commands/teach.js";
import { readGlobalLockfile } from "../../src/core/lockfile.js";
import { readGlobalManifest } from "../../src/core/manifest.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(tmpdir(), `skilltree-teach-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	await mkdir(join(tempDir, "home", ".claude"), { recursive: true });
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("teachCommand", () => {
	test("adds skilltree skill to global manifest", async () => {
		const dir = await setup();
		const globalDir = join(dir, "global-config");
		await teachCommand({ homeDir: join(dir, "home"), globalDir });

		const manifest = await readGlobalManifest(globalDir);
		expect(manifest.dependencies?.skilltree).toBeDefined();
		const dep = manifest.dependencies?.skilltree as { local?: string };
		expect(dep.local).toContain("skills/skilltree");
	});

	test("creates lockfile with skilltree entry", async () => {
		const dir = await setup();
		const globalDir = join(dir, "global-config");
		await teachCommand({ homeDir: join(dir, "home"), globalDir });

		const lockfile = await readGlobalLockfile(globalDir);
		expect(lockfile).not.toBeNull();
		expect(lockfile?.packages?.skilltree).toBeDefined();
		expect(lockfile?.packages?.skilltree?.type).toBe("skill");
	});

	test("prints completion hint in output", async () => {
		const dir = await setup();
		const globalDir = join(dir, "global-config");

		const logs: string[] = [];
		const orig = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await teachCommand({ homeDir: join(dir, "home"), globalDir });
		} finally {
			console.log = orig;
		}

		const output = logs.join("\n");
		expect(output).toContain("completion");
		expect(output).toContain("zsh");
	});

	test("overwrites existing skill on re-run", async () => {
		const dir = await setup();
		const globalDir = join(dir, "global-config");
		await teachCommand({ homeDir: join(dir, "home"), globalDir });
		await teachCommand({ homeDir: join(dir, "home"), globalDir });

		const manifest = await readGlobalManifest(globalDir);
		expect(manifest.dependencies?.skilltree).toBeDefined();
	});
});
