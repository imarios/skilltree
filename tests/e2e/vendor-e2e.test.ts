import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand } from "../../src/commands/install.js";
import { unvendorCommand, vendorCommand } from "../../src/commands/vendor.js";
import { readManifest, writeManifest } from "../../src/core/manifest.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-vendor-e2e-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function setupProject(dir: string): Promise<void> {
	// Create skilltree.yml
	await writeFile(
		join(dir, "skilltree.yml"),
		`name: test-project
dev_install_path: .claude
dependencies:
  my-skill:
    local: ./skills/my-skill
  my-other:
    local: ./skills/my-other
`,
	);

	// Create .gitignore
	await writeFile(join(dir, ".gitignore"), ".claude/skills/\n.claude/agents/\n");

	// Create skills
	await createLocalSkill(join(dir, "skills"), "my-skill");
	await createLocalSkill(join(dir, "skills"), "my-other");
}

describe("vendor e2e", () => {
	test("vendor copies all deps as real files (no symlinks)", async () => {
		const dir = await makeTempDir();
		await setupProject(dir);

		// First do a normal install to get symlinks
		await installCommand(dir, {});

		// Verify symlinks
		const skillPath = join(dir, ".claude", "skills", "my-skill");
		const statsBeforeVendor = await lstat(skillPath);
		expect(statsBeforeVendor.isSymbolicLink()).toBe(true);

		// Now vendor
		await vendorCommand(dir, {});

		// Verify copies (not symlinks)
		const statsAfterVendor = await lstat(skillPath);
		expect(statsAfterVendor.isSymbolicLink()).toBe(false);
		expect(statsAfterVendor.isDirectory()).toBe(true);

		// Verify SKILL.md exists in the copied directory
		const skillMd = await readFile(join(skillPath, "SKILL.md"), "utf-8");
		expect(skillMd).toContain("my-skill");

		// Verify both skills are copied
		const otherPath = join(dir, ".claude", "skills", "my-other");
		expect(existsSync(otherPath)).toBe(true);
	});

	test("vendor sets vendor: true in manifest", async () => {
		const dir = await makeTempDir();
		await setupProject(dir);

		await vendorCommand(dir, {});

		const manifest = await readManifest(dir);
		expect(manifest.vendor).toBe(true);
	});

	test("vendor removes .gitignore entries", async () => {
		const dir = await makeTempDir();
		await setupProject(dir);

		await vendorCommand(dir, {});

		const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
		expect(gitignore).not.toContain(".claude/skills/");
		expect(gitignore).not.toContain(".claude/agents/");
	});

	test("vendor --dry-run makes no changes", async () => {
		const dir = await makeTempDir();
		await setupProject(dir);

		await vendorCommand(dir, { dryRun: true });

		// Manifest should NOT have vendor: true
		const manifest = await readManifest(dir);
		expect(manifest.vendor).toBeUndefined();

		// .gitignore should still have entries
		const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
		expect(gitignore).toContain(".claude/skills/");
	});

	test("vendor is idempotent", async () => {
		const dir = await makeTempDir();
		await setupProject(dir);

		await vendorCommand(dir, {});
		await vendorCommand(dir, {}); // Run again — should not error

		const manifest = await readManifest(dir);
		expect(manifest.vendor).toBe(true);

		// Files should still be there
		const skillPath = join(dir, ".claude", "skills", "my-skill");
		expect(existsSync(skillPath)).toBe(true);
	});

	test("unvendor deletes vendored files and restores gitignore", async () => {
		const dir = await makeTempDir();
		await setupProject(dir);

		// Vendor first
		await vendorCommand(dir, {});

		const skillPath = join(dir, ".claude", "skills", "my-skill");
		expect(existsSync(skillPath)).toBe(true);

		// Unvendor
		await unvendorCommand(dir);

		// Files should be deleted
		expect(existsSync(skillPath)).toBe(false);

		// Manifest should not have vendor
		const manifest = await readManifest(dir);
		expect(manifest.vendor).toBeUndefined();

		// .gitignore should be restored
		const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
		expect(gitignore).toContain(".claude/skills/");
		expect(gitignore).toContain(".claude/agents/");
	});

	test("unvendor --dry-run leaves vendored files, manifest, and gitignore untouched", async () => {
		const dir = await makeTempDir();
		await setupProject(dir);

		// Vendor first
		await vendorCommand(dir, {});

		const skillPath = join(dir, ".claude", "skills", "my-skill");
		expect(existsSync(skillPath)).toBe(true);
		const gitignoreBefore = await readFile(join(dir, ".gitignore"), "utf-8");

		// Capture stdout so we can assert dry-run advertised itself
		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await unvendorCommand(dir, { dryRun: true });
		} finally {
			console.log = originalLog;
		}

		// Files still present
		expect(existsSync(skillPath)).toBe(true);

		// Manifest still in vendor mode
		const manifest = await readManifest(dir);
		expect(manifest.vendor).toBe(true);

		// .gitignore unchanged
		const gitignoreAfter = await readFile(join(dir, ".gitignore"), "utf-8");
		expect(gitignoreAfter).toBe(gitignoreBefore);

		const output = logs.join("\n");
		expect(output.toLowerCase()).toContain("dry run");
	});

	test("unvendor when not vendored warns and does nothing", async () => {
		const dir = await makeTempDir();
		await setupProject(dir);

		// Should not throw, just warn
		await unvendorCommand(dir);

		// Manifest unchanged
		const manifest = await readManifest(dir);
		expect(manifest.vendor).toBeUndefined();
	});

	test("install refuses when vendor mode is active", async () => {
		const dir = await makeTempDir();
		await setupProject(dir);

		// Set vendor mode
		const manifest = await readManifest(dir);
		manifest.vendor = true;
		await writeManifest(dir, manifest);

		// Install should warn and return (not throw)
		await installCommand(dir, {});

		// No files should be created (install was a no-op)
		// But it shouldn't throw either
	});

	test("install --force overrides vendor guard", async () => {
		const dir = await makeTempDir();
		await setupProject(dir);

		// Set vendor mode
		const manifest = await readManifest(dir);
		manifest.vendor = true;
		await writeManifest(dir, manifest);

		// Install with --force should work
		await installCommand(dir, { force: true });

		// Skills should be installed (as symlinks since no --install-path)
		const skillPath = join(dir, ".claude", "skills", "my-skill");
		const stats = await lstat(skillPath);
		expect(stats.isSymbolicLink()).toBe(true);
	});

	test("full round-trip: install → vendor → unvendor → install", async () => {
		const dir = await makeTempDir();
		await setupProject(dir);

		// 1. Normal install — symlinks
		await installCommand(dir, {});
		let stats = await lstat(join(dir, ".claude", "skills", "my-skill"));
		expect(stats.isSymbolicLink()).toBe(true);

		// 2. Vendor — copies
		await vendorCommand(dir, {});
		stats = await lstat(join(dir, ".claude", "skills", "my-skill"));
		expect(stats.isSymbolicLink()).toBe(false);
		expect(stats.isDirectory()).toBe(true);

		let manifest = await readManifest(dir);
		expect(manifest.vendor).toBe(true);

		// 3. Unvendor — cleanup
		await unvendorCommand(dir);
		expect(existsSync(join(dir, ".claude", "skills", "my-skill"))).toBe(false);

		manifest = await readManifest(dir);
		expect(manifest.vendor).toBeUndefined();

		// 4. Install again — back to symlinks
		await installCommand(dir, {});
		stats = await lstat(join(dir, ".claude", "skills", "my-skill"));
		expect(stats.isSymbolicLink()).toBe(true);
	});

	test("unvendor warns and aborts if vendored files were modified", async () => {
		const dir = await makeTempDir();
		await setupProject(dir);

		await vendorCommand(dir, {});

		// Modify a vendored file (need to make writable first since vendor sets 444)
		const skillMd = join(dir, ".claude", "skills", "my-skill", "SKILL.md");
		await chmod(skillMd, 0o644);
		await writeFile(skillMd, "---\nname: my-skill\n---\n\n# Modified by user\n");

		// Unvendor should warn about modified files and NOT delete them
		await expect(unvendorCommand(dir)).rejects.toThrow("modified");

		// Files should still exist (unvendor aborted)
		expect(existsSync(join(dir, ".claude", "skills", "my-skill"))).toBe(true);

		// Manifest should still have vendor: true (unvendor aborted)
		const manifest = await readManifest(dir);
		expect(manifest.vendor).toBe(true);
	});

	test("vendor creates lockfile with integrity hashes", async () => {
		const dir = await makeTempDir();
		await setupProject(dir);

		await vendorCommand(dir, {});

		const lockContent = await readFile(join(dir, "skilltree.lock"), "utf-8");
		expect(lockContent).toContain("integrity:");
	});

	test("vendor copies agent to agents/ as real file", async () => {
		const dir = await makeTempDir();

		// Create a local agent
		const agentDir = join(dir, "agents", "source");
		await mkdir(agentDir, { recursive: true });
		await writeFile(join(agentDir, "my-agent.md"), "---\nname: my-agent\n---\n\n# My Agent\n");

		await writeFile(
			join(dir, "skilltree.yml"),
			`name: test-project
dev_install_path: .claude
dependencies:
  my-agent:
    local: ./agents/source/my-agent.md
    type: agent
`,
		);
		await writeFile(join(dir, ".gitignore"), ".claude/skills/\n.claude/agents/\n");

		// Install first (creates symlink)
		await installCommand(dir, {});
		const agentPath = join(dir, ".claude", "agents", "my-agent.md");
		let stats = await lstat(agentPath);
		expect(stats.isSymbolicLink()).toBe(true);

		// Vendor (should become a real file copy)
		await vendorCommand(dir, {});
		stats = await lstat(agentPath);
		expect(stats.isSymbolicLink()).toBe(false);
		expect(stats.isFile()).toBe(true);

		const content = await readFile(agentPath, "utf-8");
		expect(content).toContain("my-agent");
	});

	test("vendor mixed agent + skill — both vendored correctly", async () => {
		const dir = await makeTempDir();

		// Create local skill and agent
		await createLocalSkill(join(dir, "skills"), "coding-skill");

		const agentDir = join(dir, "agents", "source");
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			join(agentDir, "dev-agent.md"),
			"---\nname: dev-agent\ndependencies:\n  - coding-skill\n---\n\n# Dev Agent\n",
		);

		await writeFile(
			join(dir, "skilltree.yml"),
			`name: test-project
dev_install_path: .claude
dependencies:
  coding-skill:
    local: ./skills/coding-skill
  dev-agent:
    local: ./agents/source/dev-agent.md
    type: agent
`,
		);
		await writeFile(join(dir, ".gitignore"), ".claude/skills/\n.claude/agents/\n");

		await installCommand(dir, {});
		await vendorCommand(dir, {});

		// Skill vendored as directory
		const skillPath = join(dir, ".claude", "skills", "coding-skill");
		const skillStats = await lstat(skillPath);
		expect(skillStats.isSymbolicLink()).toBe(false);
		expect(skillStats.isDirectory()).toBe(true);

		// Agent vendored as file
		const agentPath = join(dir, ".claude", "agents", "dev-agent.md");
		const agentStats = await lstat(agentPath);
		expect(agentStats.isSymbolicLink()).toBe(false);
		expect(agentStats.isFile()).toBe(true);

		// Unvendor should clean up both
		await unvendorCommand(dir);
		expect(existsSync(skillPath)).toBe(false);
		expect(existsSync(agentPath)).toBe(false);

		// .gitignore restored
		const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
		expect(gitignore).toContain(".claude/skills/");
		expect(gitignore).toContain(".claude/agents/");
	});

	test("vendor with multiple install_targets requires --target", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeFile(
			join(dir, "skilltree.yml"),
			"install_targets:\n  - claude\n  - codex\ndependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);
		await writeFile(join(dir, ".gitignore"), ".claude/skills/\n.claude/agents/\n");

		await expect(vendorCommand(dir, {})).rejects.toThrow("--target");
	});

	test("vendor with single install_target works without --target", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeFile(
			join(dir, "skilltree.yml"),
			"install_targets:\n  - claude\ndependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);
		await writeFile(join(dir, ".gitignore"), ".claude/skills/\n.claude/agents/\n");

		await installCommand(dir, {});
		await vendorCommand(dir, {});

		const skillPath = join(dir, ".claude", "skills", "my-skill");
		const stats = await lstat(skillPath);
		expect(stats.isSymbolicLink()).toBe(false);
		expect(stats.isDirectory()).toBe(true);
	});
});
