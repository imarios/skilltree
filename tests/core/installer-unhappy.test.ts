import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedEntity } from "../../src/core/graph.js";
import {
	computeIntegrity,
	executeInstall,
	planInstall,
	verifyInstalled,
} from "../../src/core/installer.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-install-unhappy-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("verify: broken symlink detection", () => {
	test("reports broken when symlink target does not exist", async () => {
		const dir = await makeTempDir();
		const installBase = join(dir, ".claude");
		await mkdir(join(installBase, "skills"), { recursive: true });

		// Create a symlink pointing to a non-existent target
		const targetPath = join(installBase, "skills", "ghost-skill");
		await symlink("/tmp/nonexistent-skilltree-path", targetPath);

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:ghost-skill",
				{
					key: "ghost-skill",
					name: "ghost-skill",
					type: "skill",
					group: "prod",
					path: "/tmp/nonexistent-skilltree-path",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const statuses = await verifyInstalled(entities, installBase, {});
		expect(statuses[0]?.status).toBe("broken");
	});
});

describe("verify: stale vendored local dep", () => {
	test("reports stale when source file is modified (content-based check)", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		const installBase = join(dir, ".claude");

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:my-skill",
				{
					key: "my-skill",
					name: "my-skill",
					type: "skill",
					group: "prod",
					path: "./skills/my-skill",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		// Install as copy (vendored)
		const plan = await planInstall(entities, ["skill:my-skill"], installBase, {
			installPath: installBase,
		});
		const integrityMap = await executeInstall(plan, dir, { installPath: installBase });

		const lockfileIntegrity: Record<string, string> = {};
		for (const [key, hash] of integrityMap) {
			lockfileIntegrity[key] = hash;
		}

		// Modify source file content (not adding a new file)
		await writeFile(
			join(dir, "skills", "my-skill", "SKILL.md"),
			"---\nname: my-skill\n---\n\n# Modified source content\n",
		);

		// Pass projectDir so relative path resolves correctly
		const statuses = await verifyInstalled(entities, installBase, lockfileIntegrity, dir);
		expect(statuses[0]?.status).toBe("stale");
	});

	test("reports stale when new file added to source", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		const installBase = join(dir, ".claude");

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:my-skill",
				{
					key: "my-skill",
					name: "my-skill",
					type: "skill",
					group: "prod",
					path: "./skills/my-skill",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const plan = await planInstall(entities, ["skill:my-skill"], installBase, {
			installPath: installBase,
		});
		const integrityMap = await executeInstall(plan, dir, { installPath: installBase });

		const lockfileIntegrity: Record<string, string> = {};
		for (const [key, hash] of integrityMap) {
			lockfileIntegrity[key] = hash;
		}

		// Add a new file to source
		await writeFile(join(dir, "skills", "my-skill", "extra.md"), "# Extra\n");

		const statuses = await verifyInstalled(entities, installBase, lockfileIntegrity, dir);
		expect(statuses[0]?.status).toBe("stale");
	});

	test("reports ok when source matches vendored copy", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		const installBase = join(dir, ".claude");

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:my-skill",
				{
					key: "my-skill",
					name: "my-skill",
					type: "skill",
					group: "prod",
					path: "./skills/my-skill",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const plan = await planInstall(entities, ["skill:my-skill"], installBase, {
			installPath: installBase,
		});
		const integrityMap = await executeInstall(plan, dir, { installPath: installBase });

		const lockfileIntegrity: Record<string, string> = {};
		for (const [key, hash] of integrityMap) {
			lockfileIntegrity[key] = hash;
		}

		// No modifications — should be ok
		const statuses = await verifyInstalled(entities, installBase, lockfileIntegrity, dir);
		expect(statuses[0]?.status).toBe("ok");
	});
});

describe("integrity hash edge cases", () => {
	test("excludes .git directory from hash", async () => {
		const dir = await makeTempDir();
		const skillDir = join(dir, "test-skill");
		await mkdir(skillDir, { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), "# Test\n");

		const hashWithout = await computeIntegrity(skillDir);

		// Add a .git directory
		await mkdir(join(skillDir, ".git"), { recursive: true });
		await writeFile(join(skillDir, ".git", "config"), "some git config");

		const hashWith = await computeIntegrity(skillDir);

		// .git should be excluded, so hashes should match
		expect(hashWithout).toBe(hashWith);
	});

	test("handles nested subdirectories deterministically", async () => {
		const dir = await makeTempDir();
		const skillDir = join(dir, "test-skill");
		await mkdir(join(skillDir, "references", "deep"), { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), "# Test\n");
		await writeFile(join(skillDir, "references", "ref.md"), "# Ref\n");
		await writeFile(join(skillDir, "references", "deep", "nested.md"), "# Nested\n");

		const hash1 = await computeIntegrity(skillDir);
		const hash2 = await computeIntegrity(skillDir);
		expect(hash1).toBe(hash2);
	});

	test("different file content in subdirectory changes hash", async () => {
		const dir = await makeTempDir();
		const skillDir = join(dir, "test-skill");
		await mkdir(join(skillDir, "references"), { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), "# Test\n");
		await writeFile(join(skillDir, "references", "ref.md"), "# Version 1\n");

		const hash1 = await computeIntegrity(skillDir);

		await writeFile(join(skillDir, "references", "ref.md"), "# Version 2\n");

		const hash2 = await computeIntegrity(skillDir);
		expect(hash1).not.toBe(hash2);
	});

	test("filename matters for hash", async () => {
		const dir = await makeTempDir();

		// Same content, different filenames
		const dir1 = join(dir, "skill-a");
		await mkdir(dir1, { recursive: true });
		await writeFile(join(dir1, "alpha.md"), "content");

		const dir2 = join(dir, "skill-b");
		await mkdir(dir2, { recursive: true });
		await writeFile(join(dir2, "beta.md"), "content");

		const hash1 = await computeIntegrity(dir1);
		const hash2 = await computeIntegrity(dir2);
		expect(hash1).not.toBe(hash2);
	});
});

describe("install with existing non-symlink files (no --force)", () => {
	test("warns when remote dep already installed without --force", async () => {
		const dir = await makeTempDir();
		const installBase = join(dir, ".claude");
		await mkdir(join(installBase, "skills", "existing-skill"), { recursive: true });
		await writeFile(join(installBase, "skills", "existing-skill", "SKILL.md"), "# Already here\n");

		const entities = new Map<string, ResolvedEntity>([
			[
				"skill:existing-skill",
				{
					key: "existing-skill",
					name: "existing-skill",
					type: "skill",
					group: "prod",
					repo: "github.com/test/repo",
					path: "skills/existing-skill",
					version: "1.0.0",
					tag: "v1.0.0",
					commit: "abc",
					local: false,
					dependencies: [],
				},
			],
		]);

		const plan = await planInstall(entities, ["skill:existing-skill"], installBase, {});
		await executeInstall(plan, dir, {}); // No --force

		// Should have a warning about already installed
		expect(plan.warnings.some((w) => w.includes("already installed"))).toBe(true);
	});
});
