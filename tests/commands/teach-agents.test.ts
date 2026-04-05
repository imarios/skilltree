import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { teachCommand } from "../../src/commands/teach.js";
import { readGlobalLockfile } from "../../src/core/lockfile.js";
import { readGlobalManifest } from "../../src/core/manifest.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-teach-agents-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("teach auto-detection", () => {
	test("detects single agent and adds to global manifest", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "home");
		const globalDir = join(dir, "global-config");
		await mkdir(join(fakeHome, ".codex"), { recursive: true });

		await teachCommand({ homeDir: fakeHome, globalDir });

		const manifest = await readGlobalManifest(globalDir);
		expect(manifest.install_targets).toEqual(["codex"]);
		expect(manifest.dependencies?.skilltree).toBeDefined();
	});

	test("detects all agents and sets install_targets", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "home");
		const globalDir = join(dir, "global-config");
		await mkdir(join(fakeHome, ".claude"), { recursive: true });
		await mkdir(join(fakeHome, ".codex"), { recursive: true });

		await teachCommand({ homeDir: fakeHome, globalDir });

		const manifest = await readGlobalManifest(globalDir);
		expect(manifest.install_targets).toContain("claude");
		expect(manifest.install_targets).toContain("codex");
	});

	test("--agent restricts install_targets to one agent", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "home");
		const globalDir = join(dir, "global-config");
		await mkdir(join(fakeHome, ".claude"), { recursive: true });
		await mkdir(join(fakeHome, ".codex"), { recursive: true });

		await teachCommand({ homeDir: fakeHome, agent: "claude", globalDir });

		const manifest = await readGlobalManifest(globalDir);
		expect(manifest.install_targets).toEqual(["claude"]);
	});

	test("errors when no agents detected", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });

		await expect(teachCommand({ homeDir: fakeHome })).rejects.toThrow("no agents detected");
	});
});

describe("teach as global dep", () => {
	test("adds skilltree to global manifest as a local dependency", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "home");
		const globalDir = join(dir, "global-config");
		await mkdir(join(fakeHome, ".claude"), { recursive: true });

		await teachCommand({ homeDir: fakeHome, globalDir });

		const manifest = await readGlobalManifest(globalDir);
		expect(manifest.dependencies?.skilltree).toBeDefined();
		const dep = manifest.dependencies?.skilltree as { local?: string };
		expect(dep.local).toBeDefined();
	});

	test("creates global lockfile with skilltree entry", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "home");
		const globalDir = join(dir, "global-config");
		await mkdir(join(fakeHome, ".claude"), { recursive: true });

		await teachCommand({ homeDir: fakeHome, globalDir });

		const lockfile = await readGlobalLockfile(globalDir);
		expect(lockfile).not.toBeNull();
		expect(lockfile?.packages?.skilltree).toBeDefined();
	});

	test("is idempotent — second run updates without error", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "home");
		const globalDir = join(dir, "global-config");
		await mkdir(join(fakeHome, ".claude"), { recursive: true });

		await teachCommand({ homeDir: fakeHome, globalDir });
		await teachCommand({ homeDir: fakeHome, globalDir });

		const manifest = await readGlobalManifest(globalDir);
		expect(manifest.dependencies?.skilltree).toBeDefined();
	});

	test("sets install_targets on global manifest from detected agents", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "home");
		const globalDir = join(dir, "global-config");
		await mkdir(join(fakeHome, ".claude"), { recursive: true });
		await mkdir(join(fakeHome, ".codex"), { recursive: true });

		await teachCommand({ homeDir: fakeHome, globalDir });

		const manifest = await readGlobalManifest(globalDir);
		expect(manifest.install_targets).toContain("claude");
		expect(manifest.install_targets).toContain("codex");
	});
});
