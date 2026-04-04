import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addCommand } from "../../src/commands/add.js";
import { installCommand } from "../../src/commands/install.js";
import { removeCommand } from "../../src/commands/remove.js";
import { readGlobalLockfile } from "../../src/core/lockfile.js";
import { readGlobalManifest } from "../../src/core/manifest.js";
import type { Dependency } from "../../src/types.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-global-e2e-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

/**
 * Create a local skill source directory with multiple skills.
 */
async function createSkillSource(
	baseDir: string,
	skills: Array<{ name: string; deps?: string[]; isAgent?: boolean }>,
): Promise<string> {
	const sourceDir = join(baseDir, "my-skills");

	for (const skill of skills) {
		if (skill.isAgent) {
			const agentDir = join(sourceDir, "agents");
			await mkdir(agentDir, { recursive: true });
			const deps = skill.deps?.length
				? `dependencies:\n${skill.deps.map((d) => `  - ${d}`).join("\n")}`
				: "";
			await writeFile(
				join(agentDir, `${skill.name}.md`),
				`---\nname: ${skill.name}\n${deps}\n---\n\n# ${skill.name}\n`,
			);
		} else {
			const skillDir = join(sourceDir, "skills", skill.name);
			await mkdir(skillDir, { recursive: true });
			const deps = skill.deps?.length
				? `dependencies:\n${skill.deps.map((d) => `  - ${d}`).join("\n")}`
				: "";
			await writeFile(
				join(skillDir, "SKILL.md"),
				`---\nname: ${skill.name}\n${deps}\n---\n\n# ${skill.name}\n`,
			);
		}
	}

	return sourceDir;
}

describe("global deps e2e", () => {
	test("init --global creates global.yaml", async () => {
		const dir = await makeTempDir();
		const globalDir = join(dir, "global-config");

		// Mock global dir by passing it to the command
		// Since initCommand uses getGlobalDir(), we test the underlying manifest ops
		await mkdir(globalDir, { recursive: true });
		const { writeGlobalManifest } = await import("../../src/core/manifest.js");
		await writeGlobalManifest({ dependencies: {} }, globalDir);

		const manifest = await readGlobalManifest(globalDir);
		expect(manifest.dependencies).toEqual({});
	});

	test("add --global writes to global manifest", async () => {
		const dir = await makeTempDir();
		const globalDir = join(dir, "global-config");
		const { writeGlobalManifest } = await import("../../src/core/manifest.js");
		await writeGlobalManifest({ dependencies: {} }, globalDir);

		const sourceDir = await createSkillSource(dir, [
			{ name: "python-coding" },
			{ name: "testing" },
		]);

		await addCommand(
			"python-coding",
			{
				local: join(sourceDir, "skills/python-coding"),
				global: true,
				globalDir,
			},
			dir,
		);

		const manifest = await readGlobalManifest(globalDir);
		expect(manifest.dependencies?.["python-coding"]).toBeDefined();
		const dep = manifest.dependencies?.["python-coding"] as unknown as Record<string, unknown>;
		expect(dep?.local).toContain("python-coding");
	});

	test("add --global --dev errors", async () => {
		const dir = await makeTempDir();
		const globalDir = join(dir, "global-config");
		const { writeGlobalManifest } = await import("../../src/core/manifest.js");
		await writeGlobalManifest({ dependencies: {} }, globalDir);

		await expect(
			addCommand(
				"test",
				{
					local: "/tmp/fake",
					global: true,
					dev: true,
					globalDir,
				},
				dir,
			),
		).rejects.toThrow("--global and --dev are mutually exclusive");
	});

	test("install --global installs local deps as symlinks", async () => {
		const dir = await makeTempDir();
		const globalDir = join(dir, "global-config");

		const sourceDir = await createSkillSource(dir, [{ name: "python-coding" }]);

		const { writeGlobalManifest } = await import("../../src/core/manifest.js");
		await writeGlobalManifest(
			{
				dependencies: {
					"python-coding": {
						local: join(sourceDir, "skills/python-coding"),
					},
				},
			},
			globalDir,
		);

		// Mock getGlobalInstallBase — we pass installBase via internal resolution
		// The install command uses getGlobalDir/getGlobalInstallBase, but we can test
		// the core functions directly for isolated testing

		const { resolveAll } = await import("../../src/core/graph.js");
		const manifest = await readGlobalManifest(globalDir);
		const result = await resolveAll(manifest, globalDir);

		expect(result.errors).toEqual([]);
		expect(result.entities.size).toBe(1);

		const entity = result.entities.get("skill:python-coding");
		expect(entity).toBeDefined();
		expect(entity?.local).toBe(true);
	});

	test("install --global + --prod errors", async () => {
		const dir = await makeTempDir();
		await expect(
			installCommand(dir, {
				global: true,
				prod: true,
				globalDir: dir,
			}),
		).rejects.toThrow("--prod and --global are incompatible");
	});

	test("install --global + --install-path errors", async () => {
		const dir = await makeTempDir();
		await expect(
			installCommand(dir, {
				global: true,
				installPath: "/tmp/foo",
				globalDir: dir,
			}),
		).rejects.toThrow("--install-path and --global are incompatible");
	});

	test("full global lifecycle: add, install, verify, remove", async () => {
		const dir = await makeTempDir();
		const globalDir = join(dir, "global-config");
		const installBase = join(dir, "claude-home");

		const sourceDir = await createSkillSource(dir, [{ name: "skill-a" }, { name: "skill-b" }]);

		// Init
		const { writeGlobalManifest } = await import("../../src/core/manifest.js");
		await writeGlobalManifest({ dependencies: {} }, globalDir);

		// Add
		await addCommand(
			"skill-a",
			{
				local: join(sourceDir, "skills/skill-a"),
				global: true,
				globalDir,
			},
			dir,
		);

		await addCommand(
			"skill-b",
			{
				local: join(sourceDir, "skills/skill-b"),
				global: true,
				globalDir,
			},
			dir,
		);

		// Verify manifest
		const manifest = await readGlobalManifest(globalDir);
		expect(Object.keys(manifest.dependencies ?? {}).length).toBe(2);

		// Install (resolve directly to test core)
		const { resolveAll } = await import("../../src/core/graph.js");
		const { planInstall, executeInstall } = await import("../../src/core/installer.js");
		const { buildLockfile, writeGlobalLockfile } = await import("../../src/core/lockfile.js");

		const result = await resolveAll(manifest, globalDir);
		expect(result.errors).toEqual([]);

		const plan = await planInstall(result.entities, result.installOrder, installBase, {});
		expect(plan.toInstall.length).toBe(2);

		// All should be symlinks (local deps)
		for (const item of plan.toInstall) {
			expect(item.action).toBe("symlink");
		}

		await executeInstall(plan, globalDir, {});

		// Verify symlinks exist
		const symlinkA = join(installBase, "skills", "skill-a");
		const statsA = await lstat(symlinkA);
		expect(statsA.isSymbolicLink()).toBe(true);

		const symlinkB = join(installBase, "skills", "skill-b");
		const statsB = await lstat(symlinkB);
		expect(statsB.isSymbolicLink()).toBe(true);

		// Build and write lockfile
		const lockfile = buildLockfile(result.entities, { global: true });
		await writeGlobalLockfile(lockfile, globalDir);

		const readBack = await readGlobalLockfile(globalDir);
		expect(readBack).not.toBeNull();
		expect(Object.keys(readBack?.packages ?? {}).length).toBe(2);

		// Remove
		await removeCommand("skill-a", dir, {
			global: true,
			globalDir,
			force: true,
		});

		const updatedManifest = await readGlobalManifest(globalDir);
		expect(updatedManifest.dependencies?.["skill-a"]).toBeUndefined();
		expect(updatedManifest.dependencies?.["skill-b"]).toBeDefined();
	});

	test("local source with same-origin transitive resolution", async () => {
		const dir = await makeTempDir();
		const globalDir = join(dir, "global-config");

		// skill-a depends on skill-b — both in same source
		const sourceDir = await createSkillSource(dir, [
			{ name: "skill-a", deps: ["skill-b"] },
			{ name: "skill-b" },
		]);

		const { writeGlobalManifest } = await import("../../src/core/manifest.js");
		await writeGlobalManifest(
			{
				sources: { mine: sourceDir },
				dependencies: {
					"skill-a": {
						source: "mine",
						path: "skills/skill-a",
					} as Dependency,
				},
			},
			globalDir,
		);

		const { resolveAll } = await import("../../src/core/graph.js");
		const manifest = await readGlobalManifest(globalDir);
		const result = await resolveAll(manifest, globalDir);

		expect(result.errors).toEqual([]);
		expect(result.entities.size).toBe(2);
		expect(result.entities.has("skill:skill-a")).toBe(true);
		expect(result.entities.has("skill:skill-b")).toBe(true);

		// skill-b should have been resolved via same-origin
		const skillB = result.entities.get("skill:skill-b");
		expect(skillB?.sourceDir).toBe(sourceDir);
	});

	test("switching from remote to local creates symlink, back to remote creates copy", async () => {
		const dir = await makeTempDir();
		const globalDir = join(dir, "global-config");
		const installBase = join(dir, "claude-home");

		// Create a local skill source
		const sourceDir = join(dir, "my-skills");
		await createSkillSource(dir, [{ name: "my-skill" }]);

		// Also create a git repo with the same skill for remote install
		const { createTestRepo } = await import("../helpers/git-fixtures.js");
		const simpleGit = (await import("simple-git")).default;

		const repoDir = await createTestRepo(
			dir,
			"remote-repo",
			[{ path: "skills/my-skill", name: "my-skill" }],
			"v1.0.0",
		);
		const bareDir = join(dir, "bare.git");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const { writeGlobalManifest } = await import("../../src/core/manifest.js");
		const { resolveAll } = await import("../../src/core/graph.js");
		const { planInstall, executeInstall } = await import("../../src/core/installer.js");
		const { lstat: lstatFile } = await import("node:fs/promises");

		// Step 1: Install as remote dep (should be a copy)
		await writeGlobalManifest(
			{
				dependencies: {
					"my-skill": {
						repo: `file://${bareDir}`,
						path: "skills/my-skill",
						version: "*",
					},
				},
			},
			globalDir,
		);

		let manifest = await readGlobalManifest(globalDir);
		let result = await resolveAll(manifest, globalDir);
		expect(result.errors).toEqual([]);

		let plan = await planInstall(result.entities, result.installOrder, installBase, {});
		expect(plan.toInstall[0]?.action).toBe("copy");
		await executeInstall(plan, globalDir, { force: true });

		let stats = await lstatFile(join(installBase, "skills", "my-skill"));
		expect(stats.isSymbolicLink()).toBe(false);
		expect(stats.isDirectory()).toBe(true);

		// Step 2: Switch to local dep (should become a symlink)
		await writeGlobalManifest(
			{
				dependencies: {
					"my-skill": {
						local: join(sourceDir, "skills/my-skill"),
					},
				},
			},
			globalDir,
		);

		manifest = await readGlobalManifest(globalDir);
		result = await resolveAll(manifest, globalDir);
		expect(result.errors).toEqual([]);

		plan = await planInstall(result.entities, result.installOrder, installBase, {});
		expect(plan.toInstall[0]?.action).toBe("symlink");
		await executeInstall(plan, globalDir, { force: true });

		stats = await lstatFile(join(installBase, "skills", "my-skill"));
		expect(stats.isSymbolicLink()).toBe(true);

		// Step 3: Switch back to remote (should be a copy again)
		await writeGlobalManifest(
			{
				dependencies: {
					"my-skill": {
						repo: `file://${bareDir}`,
						path: "skills/my-skill",
						version: "*",
					},
				},
			},
			globalDir,
		);

		manifest = await readGlobalManifest(globalDir);
		result = await resolveAll(manifest, globalDir);
		expect(result.errors).toEqual([]);

		plan = await planInstall(result.entities, result.installOrder, installBase, {});
		expect(plan.toInstall[0]?.action).toBe("copy");
		await executeInstall(plan, globalDir, { force: true });

		stats = await lstatFile(join(installBase, "skills", "my-skill"));
		expect(stats.isSymbolicLink()).toBe(false);
		expect(stats.isDirectory()).toBe(true);
	});

	test("global lockfile preserves tilde in paths", async () => {
		const { homedir } = await import("node:os");
		const home = homedir();

		const { buildLockfile, serializeLockfile, parseLockfile } = await import(
			"../../src/core/lockfile.js"
		);

		const entities = new Map();
		entities.set("skill:test-skill", {
			key: "test-skill",
			name: "test-skill",
			type: "skill",
			group: "prod",
			path: `${home}/Projects/skills/test-skill`,
			commit: "HEAD",
			local: true,
			dependencies: [],
		});

		const lockfile = buildLockfile(entities, { global: true });
		const serialized = serializeLockfile(lockfile);

		// Should contain ~ prefix, not expanded home dir
		expect(serialized).toContain("~/Projects/skills/test-skill");
		expect(serialized).not.toContain(home);

		// Roundtrip
		const parsed = parseLockfile(serialized);
		expect(parsed.packages["test-skill"]?.path).toBe("~/Projects/skills/test-skill");
	});
});
