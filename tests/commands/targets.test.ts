import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	targetsAddCommand,
	targetsDetectCommand,
	targetsMigrateCommand,
	targetsRemoveCommand,
} from "../../src/commands/targets.js";
import { readManifest } from "../../src/core/manifest.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-targets-"));
	return tempDir;
}

async function writeManifestFile(dir: string, content: string): Promise<void> {
	await writeFile(join(dir, "skilltree.yaml"), content, "utf-8");
}

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("targetsAddCommand", () => {
	test("adds known agent to install_targets", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "install_targets:\n  - claude\ndependencies: {}\n");

		await targetsAddCommand("codex", dir);

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toContain("claude");
		expect(manifest.install_targets).toContain("codex");
	});

	test("adds custom path to install_targets", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "install_targets:\n  - claude\ndependencies: {}\n");

		await targetsAddCommand("./my-agent", dir);

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toContain("./my-agent");
	});

	test("rejects duplicate target", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "install_targets:\n  - claude\ndependencies: {}\n");

		await expect(targetsAddCommand("claude", dir)).rejects.toThrow("already in install_targets");
	});

	test("rejects unknown bare word", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "install_targets:\n  - claude\ndependencies: {}\n");

		await expect(targetsAddCommand("unknown-thing", dir)).rejects.toThrow("unknown agent");
	});

	test("errors when dev_install_path is set", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "dev_install_path: .claude\ndependencies: {}\n");

		await expect(targetsAddCommand("codex", dir)).rejects.toThrow("targets migrate");
	});

	test("creates install_targets field if absent", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "dependencies: {}\n");

		await targetsAddCommand("codex", dir);

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toContain("claude");
		expect(manifest.install_targets).toContain("codex");
	});
});

describe("targetsRemoveCommand", () => {
	test("removes target from install_targets", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "install_targets:\n  - claude\n  - codex\ndependencies: {}\n");

		await targetsRemoveCommand("codex", dir);

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toEqual(["claude"]);
	});

	test("errors when removing last target", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "install_targets:\n  - claude\ndependencies: {}\n");

		await expect(targetsRemoveCommand("claude", dir)).rejects.toThrow("cannot remove last target");
	});

	test("errors when target not found", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "install_targets:\n  - claude\ndependencies: {}\n");

		await expect(targetsRemoveCommand("codex", dir)).rejects.toThrow("not in install_targets");
	});

	test("errors when dev_install_path is set", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "dev_install_path: .claude\ndependencies: {}\n");

		await expect(targetsRemoveCommand("claude", dir)).rejects.toThrow("targets migrate");
	});
});

describe("targetsDetectCommand", () => {
	test("adds detected agents not already in install_targets", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "install_targets:\n  - claude\ndependencies: {}\n");

		// Create a fake home with codex installed
		const fakeHome = join(dir, "fake-home");
		await mkdir(join(fakeHome, ".claude"), { recursive: true });
		await mkdir(join(fakeHome, ".codex"), { recursive: true });

		await targetsDetectCommand(dir, { homeDir: fakeHome });

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toContain("claude");
		expect(manifest.install_targets).toContain("codex");
	});

	test("skips agents already in install_targets", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "install_targets:\n  - claude\n  - codex\ndependencies: {}\n");

		const fakeHome = join(dir, "fake-home");
		await mkdir(join(fakeHome, ".claude"), { recursive: true });
		await mkdir(join(fakeHome, ".codex"), { recursive: true });

		await targetsDetectCommand(dir, { homeDir: fakeHome });

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toEqual(["claude", "codex"]);
	});

	test("errors when dev_install_path is set", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "dev_install_path: .claude\ndependencies: {}\n");

		await expect(targetsDetectCommand(dir)).rejects.toThrow("targets migrate");
	});
});

describe("targetsMigrateCommand", () => {
	test("converts dev_install_path: .claude → install_targets: [claude]", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "dev_install_path: .claude\ndependencies: {}\n");

		await targetsMigrateCommand(dir);

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toEqual(["claude"]);
		expect(manifest.dev_install_path).toBeUndefined();
	});

	test("converts dev_install_path: .custom → install_targets: [./custom]", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "dev_install_path: .custom\ndependencies: {}\n");

		await targetsMigrateCommand(dir);

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toEqual(["./.custom"]);
		expect(manifest.dev_install_path).toBeUndefined();
	});

	test("converts legacy install_path → install_targets", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "install_path: .claude\ndependencies: {}\n");

		await targetsMigrateCommand(dir);

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toEqual(["claude"]);
		expect(manifest.install_path).toBeUndefined();
	});

	test("removes dev_install_path from manifest after migration", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(
			dir,
			"name: test\ndev_install_path: .claude\ndependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);

		await targetsMigrateCommand(dir);

		const manifest = await readManifest(dir);
		expect(manifest.dev_install_path).toBeUndefined();
		expect(manifest.install_path).toBeUndefined();
		expect(manifest.install_targets).toEqual(["claude"]);
		// Other fields preserved
		expect(manifest.name).toBe("test");
		expect(manifest.dependencies?.["my-skill"]).toBeDefined();
	});

	test("warns when no dev_install_path to migrate", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "install_targets:\n  - claude\ndependencies: {}\n");

		// Should not throw, just warn
		await targetsMigrateCommand(dir);

		// Manifest unchanged
		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toEqual(["claude"]);
	});
});
