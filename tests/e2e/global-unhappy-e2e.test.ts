import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addCommand } from "../../src/commands/add.js";
import { installCommand } from "../../src/commands/install.js";
import { removeCommand } from "../../src/commands/remove.js";
import type { Dependency } from "../../src/types.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-global-unhappy-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

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

describe("global install incompatible flags", () => {
	test("--global + --prod errors", async () => {
		const dir = await makeTempDir();
		await expect(installCommand(dir, { global: true, prod: true, globalDir: dir })).rejects.toThrow(
			"--prod and --global are incompatible",
		);
	});

	test("--global + --install-path errors", async () => {
		const dir = await makeTempDir();
		await expect(
			installCommand(dir, { global: true, installPath: "/tmp/x", globalDir: dir }),
		).rejects.toThrow("--install-path and --global are incompatible");
	});
});

describe("global add validation", () => {
	test("--global + --dev errors", async () => {
		const dir = await makeTempDir();
		const globalDir = join(dir, "global-config");
		const { writeGlobalManifest } = await import("../../src/core/manifest.js");
		await writeGlobalManifest({ dependencies: {} }, globalDir);

		await expect(
			addCommand("test", { local: "/tmp/fake", global: true, dev: true, globalDir }, dir),
		).rejects.toThrow("--global and --dev are mutually exclusive");
	});

	test("--global with non-existent local path errors", async () => {
		const dir = await makeTempDir();
		const globalDir = join(dir, "global-config");
		const { writeGlobalManifest } = await import("../../src/core/manifest.js");
		await writeGlobalManifest({ dependencies: {} }, globalDir);

		await expect(
			addCommand(
				"ghost",
				{
					local: join(dir, "nonexistent/path"),
					global: true,
					globalDir,
				},
				dir,
			),
		).rejects.toThrow();
	});
});

describe("global install with no manifest", () => {
	test("errors when global manifest does not exist", async () => {
		const dir = await makeTempDir();
		const emptyGlobalDir = join(dir, "empty-global");
		await mkdir(emptyGlobalDir, { recursive: true });

		await expect(
			installCommand(dir, { global: true, globalDir: emptyGlobalDir }),
		).rejects.toThrow();
	});
});

describe("global remove with orphan cleanup", () => {
	test("removing a skill also removes its orphaned transitive deps", async () => {
		const dir = await makeTempDir();
		const globalDir = join(dir, "global-config");
		const installBase = join(dir, "claude-home");

		// parent depends on child via same-origin
		const sourceDir = await createSkillSource(dir, [
			{ name: "parent", deps: ["child"] },
			{ name: "child" },
		]);

		const { writeGlobalManifest, readGlobalManifest: readGM } = await import(
			"../../src/core/manifest.js"
		);
		const { resolveAll } = await import("../../src/core/graph.js");
		const { planInstall, executeInstall } = await import("../../src/core/installer.js");
		const { buildLockfile, writeGlobalLockfile } = await import("../../src/core/lockfile.js");

		await writeGlobalManifest(
			{
				sources: { mine: sourceDir },
				dependencies: {
					parent: { source: "mine", path: "skills/parent" } as Dependency,
				},
			},
			globalDir,
		);

		// Install
		const manifest = await readGM(globalDir);
		const result = await resolveAll(manifest, globalDir);
		expect(result.errors).toEqual([]);
		expect(result.entities.size).toBe(2); // parent + child (transitive)

		const plan = await planInstall(result.entities, result.installOrder, installBase, {});
		await executeInstall(plan, globalDir, {});

		const lockfile = buildLockfile(result.entities, { global: true });
		await writeGlobalLockfile(lockfile, globalDir);

		// Both should exist
		expect(existsSync(join(installBase, "skills", "parent"))).toBe(true);
		expect(existsSync(join(installBase, "skills", "child"))).toBe(true);

		// Remove parent
		await removeCommand("parent", dir, {
			global: true,
			globalDir,
			force: true,
		});

		// Parent removed from manifest
		const updatedManifest = await readGM(globalDir);
		expect(updatedManifest.dependencies?.parent).toBeUndefined();
	});
});

describe("global manifest validation via install", () => {
	test("global manifest with vendor: true is rejected", async () => {
		const dir = await makeTempDir();
		const globalDir = join(dir, "global-config");
		const { writeGlobalManifest } = await import("../../src/core/manifest.js");
		await writeGlobalManifest({ dependencies: {}, vendor: true }, globalDir);

		await expect(installCommand(dir, { global: true, globalDir })).rejects.toThrow(
			"Global manifest validation failed",
		);
	});

	test("global manifest with dev-dependencies is rejected", async () => {
		const dir = await makeTempDir();
		const globalDir = join(dir, "global-config");

		// Write raw YAML to include dev-dependencies
		await mkdir(globalDir, { recursive: true });
		await writeFile(
			join(globalDir, "global.yaml"),
			'dependencies: {}\ndev-dependencies:\n  my-skill:\n    local: "/tmp/x"\n',
		);

		await expect(installCommand(dir, { global: true, globalDir })).rejects.toThrow(
			"Global manifest validation failed",
		);
	});
});
