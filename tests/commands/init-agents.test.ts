import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCommand } from "../../src/commands/init.js";
import { readManifest } from "../../src/core/manifest.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-init-agents-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("init auto-detection", () => {
	test("auto-detects agents and populates install_targets", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "home");
		await mkdir(join(fakeHome, ".claude"), { recursive: true });
		await mkdir(join(fakeHome, ".codex"), { recursive: true });

		await initCommand(dir, { homeDir: fakeHome });

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toContain("claude");
		expect(manifest.install_targets).toContain("codex");
		expect(manifest.dev_install_path).toBeUndefined();
	});

	test("falls back to [claude] when no agents detected", async () => {
		const dir = await makeTempDir();
		const fakeHome = join(dir, "empty-home");
		await mkdir(fakeHome, { recursive: true });

		await initCommand(dir, { homeDir: fakeHome });

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toEqual(["claude"]);
		expect(manifest.dev_install_path).toBeUndefined();
	});
});
