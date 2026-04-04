import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vendorCommand } from "../../src/commands/vendor.js";
import { resolveAll } from "../../src/core/graph.js";
import { verifyInstalled } from "../../src/core/installer.js";
import { parseLockfile } from "../../src/core/lockfile.js";
import { readManifest } from "../../src/core/manifest.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-vendor-unhappy-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function setupProject(dir: string): Promise<void> {
	await writeFile(
		join(dir, "skilltree.yaml"),
		`name: test-project
dev_install_path: .claude
dependencies:
  my-skill:
    local: ./skills/my-skill
  my-other:
    local: ./skills/my-other
`,
	);
	await writeFile(join(dir, ".gitignore"), ".claude/skills/\n.claude/agents/\n");
	await createLocalSkill(join(dir, "skills"), "my-skill");
	await createLocalSkill(join(dir, "skills"), "my-other");
}

describe("vendor with modified vendored files", () => {
	test("verify detects modified vendored file via integrity mismatch", async () => {
		const dir = await makeTempDir();
		await setupProject(dir);
		await vendorCommand(dir, {});

		// Read lockfile for integrity hashes
		const lockContent = await readFile(join(dir, "skilltree.lock"), "utf-8");
		const lockfile = parseLockfile(lockContent);

		const lockfileIntegrity: Record<string, string> = {};
		for (const [key, entry] of Object.entries(lockfile.packages)) {
			if (entry.integrity) {
				lockfileIntegrity[key] = entry.integrity;
			}
		}

		// Modify the vendored copy (make writable first since vendor sets 444)
		const skillMd = join(dir, ".claude", "skills", "my-skill", "SKILL.md");
		await chmod(skillMd, 0o644);
		await writeFile(skillMd, "---\nname: my-skill\n---\n\n# Tampered\n");

		const manifest = await readManifest(dir);
		const result = await resolveAll(manifest, dir);
		const installBase = join(dir, ".claude");
		const statuses = await verifyInstalled(result.entities, installBase, lockfileIntegrity, dir);

		const mySkillStatus = statuses.find((s) => s.name === "my-skill");
		expect(mySkillStatus?.status).toBe("modified");
	});
});

describe("vendor then re-vendor after source change is idempotent", () => {
	test("re-vendor picks up source changes", async () => {
		const dir = await makeTempDir();
		await setupProject(dir);

		await vendorCommand(dir, {});

		// Read initial vendored content
		const initialContent = await readFile(
			join(dir, ".claude", "skills", "my-skill", "SKILL.md"),
			"utf-8",
		);

		// Modify source
		await writeFile(
			join(dir, "skills", "my-skill", "SKILL.md"),
			"---\nname: my-skill\n---\n\n# Re-vendored content\n",
		);

		// Re-vendor
		await vendorCommand(dir, {});

		const updatedContent = await readFile(
			join(dir, ".claude", "skills", "my-skill", "SKILL.md"),
			"utf-8",
		);

		expect(updatedContent).toContain("Re-vendored content");
		expect(updatedContent).not.toBe(initialContent);
	});
});

describe("vendor with dev-dependencies includes them", () => {
	test("dev-deps are included in vendor output", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "prod-skill");
		await createLocalSkill(join(dir, "skills"), "dev-skill");

		await writeFile(
			join(dir, "skilltree.yaml"),
			"name: test\ndependencies:\n  prod-skill:\n    local: ./skills/prod-skill\ndev-dependencies:\n  dev-skill:\n    local: ./skills/dev-skill\n",
		);
		await writeFile(join(dir, ".gitignore"), ".claude/skills/\n.claude/agents/\n");

		await vendorCommand(dir, {});

		// Both prod and dev should be vendored
		expect(existsSync(join(dir, ".claude", "skills", "prod-skill"))).toBe(true);
		expect(existsSync(join(dir, ".claude", "skills", "dev-skill"))).toBe(true);

		// Both should be copies, not symlinks
		const prodStat = await lstat(join(dir, ".claude", "skills", "prod-skill"));
		expect(prodStat.isSymbolicLink()).toBe(false);
		const devStat = await lstat(join(dir, ".claude", "skills", "dev-skill"));
		expect(devStat.isSymbolicLink()).toBe(false);
	});
});

describe("vendor read-only permissions", () => {
	test("vendored files are read-only (chmod 444)", async () => {
		const dir = await makeTempDir();
		await setupProject(dir);
		await vendorCommand(dir, {});

		const skillMd = join(dir, ".claude", "skills", "my-skill", "SKILL.md");
		const stats = await lstat(skillMd);
		expect(stats.mode & 0o777).toBe(0o444);
	});
});
