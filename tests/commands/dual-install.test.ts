/**
 * Tests for dev_install_path / src_install_path dual-install behavior.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand } from "../../src/commands/install.js";
import { parseManifest, serializeManifest } from "../../src/core/manifest.js";
import type { Manifest } from "../../src/types.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(tmpdir(), `skilltree-dual-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	await mkdir(tempDir, { recursive: true });
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function createLocalSkill(dir: string, name: string): Promise<void> {
	const skillDir = join(dir, "skills", name);
	await mkdir(skillDir, { recursive: true });
	await writeFile(join(skillDir, "SKILL.md"), `---\nname: ${name}\n---\n\n# ${name}\n`);
}

async function writeManifestRaw(dir: string, manifest: Manifest): Promise<void> {
	await writeFile(join(dir, "skilltree.yml"), serializeManifest(manifest), "utf-8");
}

// --- Backward compatibility ---

describe("install_path backward compat", () => {
	test("legacy install_path is treated as dev_install_path", async () => {
		const dir = await setup();
		await createLocalSkill(dir, "my-skill");

		const manifest = parseManifest(
			"name: test\ninstall_path: .claude\ndependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);
		await writeManifestRaw(dir, manifest);

		await installCommand(dir, {});

		expect(existsSync(join(dir, ".claude", "skills", "my-skill"))).toBe(true);
	});

	test("dev_install_path works as the new field name", async () => {
		const dir = await setup();
		await createLocalSkill(dir, "my-skill");

		await writeFile(
			join(dir, "skilltree.yml"),
			"name: test\ndev_install_path: .custom-dev\ndependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);

		await installCommand(dir, {});

		expect(existsSync(join(dir, ".custom-dev", "skills", "my-skill"))).toBe(true);
	});
});

// --- src_install_path behavior ---

describe("src_install_path dual install", () => {
	test("dependencies install to both dev and src paths", async () => {
		const dir = await setup();
		await createLocalSkill(dir, "prod-skill");

		await writeFile(
			join(dir, "skilltree.yml"),
			"name: test\ndev_install_path: .claude\nsrc_install_path: src\ndependencies:\n  prod-skill:\n    local: ./skills/prod-skill\n",
		);

		await installCommand(dir, {});

		// Should exist in both locations
		expect(existsSync(join(dir, ".claude", "skills", "prod-skill"))).toBe(true);
		expect(existsSync(join(dir, "src", "skills", "prod-skill"))).toBe(true);
	});

	test("dev-dependencies install to dev path only, not src path", async () => {
		const dir = await setup();
		await createLocalSkill(dir, "dev-skill");
		await createLocalSkill(dir, "prod-skill");

		await writeFile(
			join(dir, "skilltree.yml"),
			"name: test\ndev_install_path: .claude\nsrc_install_path: src\ndependencies:\n  prod-skill:\n    local: ./skills/prod-skill\ndev-dependencies:\n  dev-skill:\n    local: ./skills/dev-skill\n",
		);

		await installCommand(dir, {});

		// dev-skill in .claude only
		expect(existsSync(join(dir, ".claude", "skills", "dev-skill"))).toBe(true);
		expect(existsSync(join(dir, "src", "skills", "dev-skill"))).toBe(false);

		// prod-skill in both
		expect(existsSync(join(dir, ".claude", "skills", "prod-skill"))).toBe(true);
		expect(existsSync(join(dir, "src", "skills", "prod-skill"))).toBe(true);
	});

	test("--prod installs dependencies to src_install_path only", async () => {
		const dir = await setup();
		await createLocalSkill(dir, "prod-skill");
		await createLocalSkill(dir, "dev-skill");

		await writeFile(
			join(dir, "skilltree.yml"),
			"name: test\ndev_install_path: .claude\nsrc_install_path: src\ndependencies:\n  prod-skill:\n    local: ./skills/prod-skill\ndev-dependencies:\n  dev-skill:\n    local: ./skills/dev-skill\n",
		);

		await installCommand(dir, { prod: true });

		// prod-skill in src only (not .claude)
		expect(existsSync(join(dir, "src", "skills", "prod-skill"))).toBe(true);
		expect(existsSync(join(dir, ".claude", "skills", "prod-skill"))).toBe(false);

		// dev-skill nowhere
		expect(existsSync(join(dir, ".claude", "skills", "dev-skill"))).toBe(false);
		expect(existsSync(join(dir, "src", "skills", "dev-skill"))).toBe(false);
	});

	test("without src_install_path, --prod still requires --install-path", async () => {
		const dir = await setup();
		await createLocalSkill(dir, "my-skill");

		await writeFile(
			join(dir, "skilltree.yml"),
			"name: test\ndependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);

		// --prod without src_install_path or --install-path → installs to dev_install_path
		// (existing behavior — deps go to .claude, dev-deps skipped)
		await installCommand(dir, { prod: true });

		expect(existsSync(join(dir, ".claude", "skills", "my-skill"))).toBe(true);
	});

	test("src_install_path copies files (never symlinks)", async () => {
		const dir = await setup();
		await createLocalSkill(dir, "my-skill");

		await writeFile(
			join(dir, "skilltree.yml"),
			"name: test\ndev_install_path: .claude\nsrc_install_path: src\ndependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);

		await installCommand(dir, {});

		const srcPath = join(dir, "src", "skills", "my-skill");
		const { lstat } = await import("node:fs/promises");
		const stat = await lstat(srcPath);
		// Should be a directory (copied), not a symlink
		expect(stat.isSymbolicLink()).toBe(false);
		expect(stat.isDirectory()).toBe(true);
	});
});

// --- Manifest parsing ---

describe("manifest parsing for install paths", () => {
	test("parses dev_install_path", () => {
		const m = parseManifest("dev_install_path: .custom\n");
		expect(m.dev_install_path).toBe(".custom");
	});

	test("parses src_install_path", () => {
		const m = parseManifest("src_install_path: src\n");
		expect(m.src_install_path).toBe("src");
	});

	test("legacy install_path still parsed", () => {
		const m = parseManifest("install_path: .claude\n");
		expect(m.install_path).toBe(".claude");
	});
});
