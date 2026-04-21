import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addCommand } from "../../src/commands/add.js";
import { initCommand } from "../../src/commands/init.js";
import { readManifest } from "../../src/core/manifest.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-add-"));
	await initCommand(tempDir);
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("addCommand", () => {
	test("adds remote dependency with repo, path, version", async () => {
		const dir = await setup();
		await addCommand(
			"task-builder",
			{ repo: "github.com/company/skills", path: "skills/task-builder", version: "^2.0.0" },
			dir,
		);

		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.["task-builder"]).toEqual({
			repo: "github.com/company/skills",
			path: "skills/task-builder",
			version: "^2.0.0",
		});
	});

	test("adds remote dependency with source shorthand", async () => {
		const dir = await setup();
		// Write a manifest with sources
		await writeFile(
			join(dir, "skilltree.yaml"),
			"name: test\nsources:\n  vibes: github.com/company/vibes\ndependencies: {}\ndev-dependencies: {}\n",
		);

		await addCommand(
			"python-coding",
			{ source: "vibes", path: "skills/python-coding", version: "^2.0.0" },
			dir,
		);

		const manifest = await readManifest(dir);
		const dep = manifest.dependencies?.["python-coding"];
		expect(dep).toBeDefined();
		expect((dep as { source: string }).source).toBe("vibes");
	});

	test("adds local dependency", async () => {
		const dir = await setup();
		const localPath = join(dir, "skills", "my-skill");
		await mkdir(localPath, { recursive: true });
		await writeFile(join(localPath, "SKILL.md"), "---\nname: my-skill\n---\n");

		await addCommand("my-skill", { local: "./skills/my-skill" }, dir);

		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.["my-skill"]).toEqual({
			local: "./skills/my-skill",
		});
	});

	test("adds dev dependency", async () => {
		const dir = await setup();
		await addCommand(
			"code-review",
			{ repo: "github.com/user/tools", path: "skills/code-review", dev: true },
			dir,
		);

		const manifest = await readManifest(dir);
		expect(manifest["dev-dependencies"]?.["code-review"]).toBeDefined();
		expect(manifest.dependencies?.["code-review"]).toBeUndefined();
	});

	test("defaults version to * when omitted", async () => {
		const dir = await setup();
		await addCommand("my-skill", { repo: "github.com/user/repo", path: "skills/my-skill" }, dir);

		const manifest = await readManifest(dir);
		expect((manifest.dependencies?.["my-skill"] as { version: string }).version).toBe("*");
	});

	test("errors when --repo and --source used together", async () => {
		const dir = await setup();
		await expect(
			addCommand(
				"broken",
				{ repo: "github.com/user/repo", source: "vibes", path: "skills/broken" },
				dir,
			),
		).rejects.toThrow("mutually exclusive");
	});

	test("errors when --repo and --local used together", async () => {
		const dir = await setup();
		await expect(
			addCommand(
				"broken",
				{ repo: "github.com/user/repo", local: "./skills/broken", path: "skills/broken" },
				dir,
			),
		).rejects.toThrow("mutually exclusive");
	});

	test("errors when no --repo/--source/--local and no registries", async () => {
		const dir = await setup();
		// Without location flags, add attempts registry lookup — fails with no registries
		// Pass configPath to avoid reading real ~/.skilltree/config.yaml
		const configPath = join(dir, "empty-config.yaml");
		await expect(addCommand("broken", { path: "skills/broken", configPath }, dir)).rejects.toThrow(
			"no registries",
		);
	});

	test("R13: adds remote dependency without --path (path inferred at install)", async () => {
		const dir = await setup();
		await addCommand("task-builder", { repo: "github.com/company/skills", version: "^2.0.0" }, dir);

		const manifest = await readManifest(dir);
		const dep = manifest.dependencies?.["task-builder"];
		expect(dep).toEqual({
			repo: "github.com/company/skills",
			version: "^2.0.0",
		});
		// Crucially, `path` is NOT written to the manifest.
		expect(dep && "path" in dep).toBe(false);
	});

	test("R13: adds source-aliased dependency without --path", async () => {
		const dir = await setup();
		await writeFile(
			join(dir, "skilltree.yaml"),
			"name: test\nsources:\n  vibes: github.com/company/vibes\ndependencies: {}\ndev-dependencies: {}\n",
		);

		await addCommand("python-coding", { source: "vibes", version: "^2.0.0" }, dir);

		const manifest = await readManifest(dir);
		const dep = manifest.dependencies?.["python-coding"];
		expect(dep).toEqual({
			source: "vibes",
			version: "^2.0.0",
		});
		expect(dep && "path" in dep).toBe(false);
	});

	test("errors when local path does not exist", async () => {
		const dir = await setup();
		await expect(addCommand("missing", { local: "./skills/nonexistent" }, dir)).rejects.toThrow(
			"does not exist",
		);
	});

	test("errors when name exists in the other group", async () => {
		const dir = await setup();
		await addCommand("shared", { repo: "github.com/user/repo", path: "skills/shared" }, dir);

		await expect(
			addCommand("shared", { repo: "github.com/user/repo", path: "skills/shared", dev: true }, dir),
		).rejects.toThrow("already exists in dependencies");
	});

	test("errors when --local and --path used together", async () => {
		const dir = await setup();
		const localPath = join(dir, "skills", "my-skill");
		await mkdir(localPath, { recursive: true });
		await writeFile(join(localPath, "SKILL.md"), "---\nname: my-skill\n---\n");

		await expect(
			addCommand("my-skill", { local: "./skills/my-skill", path: "some/path" }, dir),
		).rejects.toThrow("--local and --path are incompatible");
	});

	test("collapses home directory to ~ in --local path for --global", async () => {
		const dir = await setup();
		const { homedir } = await import("node:os");
		const home = homedir();

		// Create a skill under a path that starts with $HOME
		const skillPath = join(dir, "skills", "my-skill");
		await mkdir(skillPath, { recursive: true });
		await writeFile(join(skillPath, "SKILL.md"), "---\nname: my-skill\n---\n");

		const globalDir = join(dir, "global-config");
		const { writeGlobalManifest, readGlobalManifest } = await import("../../src/core/manifest.js");
		await writeGlobalManifest({ dependencies: {} }, globalDir);

		// Shell expands ~/... to /Users/.../... before our code sees it.
		// For --global, add should collapse $HOME back to ~ for portability.
		await addCommand("my-skill", { local: skillPath, global: true, globalDir }, dir);

		const manifest = await readGlobalManifest(globalDir);
		const dep = manifest.dependencies?.["my-skill"] as { local: string };

		// Since skillPath starts with $HOME (it's in /tmp which is under /private/...
		// on macOS, not $HOME), it won't be collapsed. Test with a home-relative path instead.
		// The key behavior: if path starts with $HOME, store as ~/...
		if (skillPath.startsWith(home)) {
			expect(dep.local.startsWith("~/")).toBe(true);
			expect(dep.local).not.toContain(home);
		} else {
			// Path is not under $HOME (e.g., /tmp) — stored as-is
			expect(dep.local).toBe(skillPath);
		}
	});

	test("collapses home directory to ~ in --local path (home-relative)", async () => {
		const { homedir } = await import("node:os");
		const home = homedir();

		// Create a temporary skill under $HOME
		const skillDir = `${home}/.skilltree-test-add-${Date.now()}`;
		await mkdir(skillDir, { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), "---\nname: home-skill\n---\n");

		const dir = await setup();
		const globalDir = join(dir, "global-config");
		const { writeGlobalManifest, readGlobalManifest } = await import("../../src/core/manifest.js");
		await writeGlobalManifest({ dependencies: {} }, globalDir);

		try {
			// Pass the absolute home path (simulating shell tilde expansion)
			await addCommand("home-skill", { local: skillDir, global: true, globalDir }, dir);

			const manifest = await readGlobalManifest(globalDir);
			const dep = manifest.dependencies?.["home-skill"] as { local: string };
			// Should be collapsed to ~/...
			expect(dep.local.startsWith("~/")).toBe(true);
			expect(dep.local).toBe(skillDir.replace(home, "~"));
		} finally {
			await rm(skillDir, { recursive: true, force: true });
		}
	});

	test("warns on overwrite in same group", async () => {
		const dir = await setup();
		await addCommand(
			"my-skill",
			{ repo: "github.com/user/repo", path: "skills/my-skill", version: "^1.0.0" },
			dir,
		);

		// Capture console.warn
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (msg: string) => warnings.push(msg);

		await addCommand(
			"my-skill",
			{ repo: "github.com/user/repo", path: "skills/my-skill", version: "^2.0.0" },
			dir,
		);

		console.warn = originalWarn;
		expect(warnings.some((w) => w.includes("overwriting"))).toBe(true);

		const manifest = await readManifest(dir);
		expect((manifest.dependencies?.["my-skill"] as { version: string }).version).toBe("^2.0.0");
	});
});
