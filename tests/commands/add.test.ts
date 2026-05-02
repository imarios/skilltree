import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addCommand } from "../../src/commands/add.js";
import { initCommand } from "../../src/commands/init.js";
import { _resetDeprecationWarningsForTests } from "../../src/core/filenames.js";
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
			join(dir, "skilltree.yml"),
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

	test("adds remote dependency with --type command (Issue #11)", async () => {
		// Slash commands are a third resource type alongside skills and agents.
		// `add --type command` must round-trip the explicit type so the resolver
		// installs to commands/ rather than guessing from the file extension.
		const dir = await setup();
		await addCommand(
			"review",
			{
				repo: "github.com/user/cmds",
				path: "commands/review.md",
				type: "command",
			},
			dir,
		);

		const manifest = await readManifest(dir);
		const dep = manifest.dependencies?.review;
		expect(dep).toBeDefined();
		expect((dep as { type: string }).type).toBe("command");
		expect((dep as { path: string }).path).toBe("commands/review.md");
	});

	test("adds local command dependency", async () => {
		const dir = await setup();
		const cmdsDir = join(dir, "commands");
		await mkdir(cmdsDir, { recursive: true });
		await writeFile(
			join(cmdsDir, "review.md"),
			"---\nname: review\ndescription: Review the diff\n---\nbody\n",
		);

		await addCommand("review", { local: "./commands/review.md", type: "command" }, dir);

		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.review).toEqual({
			local: "./commands/review.md",
			type: "command",
		});
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

	test("preserve-mode: overwrite keeps force_path and name (orthogonal user metadata)", async () => {
		const dir = await setup();
		// Seed with orthogonal fields. CLI-driven fields (repo, path, version)
		// change on re-add; orthogonal metadata survives because the CLI has
		// no way to explicitly set them.
		await writeFile(
			join(dir, "skilltree.yml"),
			[
				"name: test",
				"dependencies:",
				"  aliased-key:",
				"    repo: github.com/org/r",
				"    path: skills/old",
				"    version: '*'",
				"    force_path: true",
				"    name: actual-name",
				"dev-dependencies: {}",
				"",
			].join("\n"),
		);

		await addCommand(
			"aliased-key",
			{ repo: "github.com/org/r", path: "skills/new", version: "^2.0.0" },
			dir,
		);

		const manifest = await readManifest(dir);
		const dep = manifest.dependencies?.["aliased-key"] as {
			path?: string;
			version?: string;
			force_path?: boolean;
			name?: string;
		};
		// CLI-driven fields reflect the new values.
		expect(dep.path).toBe("skills/new");
		expect(dep.version).toBe("^2.0.0");
		// Orthogonal fields survive.
		expect(dep.force_path).toBe(true);
		expect(dep.name).toBe("actual-name");
	});

	test("R11: preserves force_path: true when re-running add on the same entry", async () => {
		const dir = await setup();
		// Seed manifest with an entry that has force_path: true,
		// plus sibling state we expect to survive the overwrite.
		await writeFile(
			join(dir, "skilltree.yml"),
			[
				"name: test",
				"sources:",
				"  vibes: github.com/company/vibes",
				"dependencies:",
				"  foo:",
				"    repo: github.com/org/r",
				"    path: skills/original",
				"    version: '*'",
				"    force_path: true",
				"  unrelated:",
				"    local: ./skills/unrelated",
				"dev-dependencies:",
				"  devonly:",
				"    local: ./skills/devonly",
				"",
			].join("\n"),
		);

		await addCommand(
			"foo",
			{ repo: "github.com/org/r", path: "skills/original", version: "^1.0.0" },
			dir,
		);

		const manifest = await readManifest(dir);
		const dep = manifest.dependencies?.foo as { force_path?: boolean; version?: string };
		expect(dep.force_path).toBe(true);
		expect(dep.version).toBe("^1.0.0");

		// Sibling manifest state must survive the overwrite.
		expect(manifest.name).toBe("test");
		expect(manifest.sources?.vibes).toBe("github.com/company/vibes");
		expect(manifest.dependencies?.unrelated).toBeDefined();
		expect(manifest["dev-dependencies"]?.devonly).toBeDefined();
	});

	test("checkOverwrite: source alias resolving to local path compares equal to direct local entry", async () => {
		const dir = await setup();
		const { homedir } = await import("node:os");
		const home = homedir();

		// Seed manifest with an existing entry `foo: {local: ~/skills-root/foo}`,
		// plus a sources: map where `mine: ~/skills-root` resolves to the same place.
		await writeFile(
			join(dir, "skilltree.yml"),
			[
				"name: test",
				"sources:",
				"  mine: ~/skills-root",
				"dependencies:",
				"  foo:",
				"    local: ~/skills-root/foo",
				"dev-dependencies: {}",
				"",
			].join("\n"),
		);

		// Create the local skill on disk so the add can validate it.
		const { mkdir } = await import("node:fs/promises");
		const skillPath = join(home, "skills-root", "foo");
		await mkdir(skillPath, { recursive: true });
		await writeFile(join(skillPath, "SKILL.md"), "---\nname: foo\n---\n");

		try {
			// Re-add as `--source mine --path foo` — should not emit a
			// "changing source from local to ~/skills-root" warning (the
			// resolved target is identical).
			await addCommand("foo", { source: "mine", path: "foo" }, dir);

			const manifest = await readManifest(dir);
			const dep = manifest.dependencies?.foo as { source?: string; path?: string };
			expect(dep.source).toBe("mine");
			expect(dep.path).toBe("foo");
		} finally {
			const { rm } = await import("node:fs/promises");
			await rm(join(home, "skills-root"), { recursive: true, force: true });
		}
	});

	test("checkOverwrite: source alias resolving to same URL as existing repo is not a 'changing source' warning", async () => {
		const dir = await setup();
		// Seed manifest with a remote entry via `repo:` and a `sources:` map
		// where the alias resolves to the same URL.
		await writeFile(
			join(dir, "skilltree.yml"),
			[
				"name: test",
				"sources:",
				"  vibes: github.com/company/vibes",
				"dependencies:",
				"  foo:",
				"    repo: github.com/company/vibes",
				"    path: skills/foo",
				"    version: '*'",
				"dev-dependencies: {}",
				"",
			].join("\n"),
		);

		// Re-add with --source that resolves to the same URL.
		// This should not throw and should succeed in overwriting.
		await addCommand("foo", { source: "vibes", path: "skills/foo" }, dir);

		// Assert the new entry was written with `source:` form.
		const manifest = await readManifest(dir);
		const dep = manifest.dependencies?.foo as { source?: string; repo?: string };
		expect(dep.source).toBe("vibes");
		expect(dep.repo).toBeUndefined();
	});

	test("R13: adds source-aliased dependency without --path", async () => {
		const dir = await setup();
		await writeFile(
			join(dir, "skilltree.yml"),
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

	test("prints hint to run `skilltree install` after adding a project dep", async () => {
		const dir = await setup();

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (msg: string) => logs.push(msg);
		try {
			await addCommand(
				"task-builder",
				{ repo: "github.com/company/skills", path: "skills/task-builder", version: "^2.0.0" },
				dir,
			);
		} finally {
			console.log = originalLog;
		}

		// Must tell the user the next step — adding to the manifest alone
		// does not install the dep (lockfile is the source of truth for list/install).
		const joined = logs.join("\n");
		expect(joined).toContain("skilltree install");
		expect(joined).not.toContain("--global");
	});

	test("prints hint to run `skilltree install --global` after adding a global dep", async () => {
		const dir = await setup();
		const localPath = join(dir, "skills", "my-skill");
		await mkdir(localPath, { recursive: true });
		await writeFile(join(localPath, "SKILL.md"), "---\nname: my-skill\n---\n");

		const globalDir = join(dir, "global-config");
		const { writeGlobalManifest } = await import("../../src/core/manifest.js");
		await writeGlobalManifest({ dependencies: {} }, globalDir);

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (msg: string) => logs.push(msg);
		try {
			await addCommand("my-skill", { local: localPath, global: true, globalDir }, dir);
		} finally {
			console.log = originalLog;
		}

		const joined = logs.join("\n");
		expect(joined).toContain("skilltree install --global");
	});
});

// Backward-compat: existing projects still on .yaml continue to work without
// the migration silently splitting their state across two files.
describe("addCommand on a legacy .yaml manifest", () => {
	let yamlDir: string;

	beforeEach(async () => {
		_resetDeprecationWarningsForTests();
		yamlDir = await mkdtemp(join(tmpdir(), "skilltree-add-yaml-"));
		await writeFile(
			join(yamlDir, "skilltree.yaml"),
			"name: legacy\ninstall_targets: [claude]\ndependencies: {}\ndev-dependencies: {}\n",
		);
	});

	afterEach(async () => {
		if (yamlDir) await rm(yamlDir, { recursive: true, force: true });
	});

	test("writes back to skilltree.yaml without creating a sibling skilltree.yml", async () => {
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (msg: string) => warnings.push(msg);
		try {
			await addCommand(
				"task-builder",
				{ repo: "github.com/company/skills", path: "skills/task-builder", version: "^2.0.0" },
				yamlDir,
			);
		} finally {
			console.warn = originalWarn;
		}

		expect(existsSync(join(yamlDir, "skilltree.yaml"))).toBe(true);
		expect(existsSync(join(yamlDir, "skilltree.yml"))).toBe(false);

		const content = await readFile(join(yamlDir, "skilltree.yaml"), "utf-8");
		expect(content).toContain("task-builder");

		const manifest = await readManifest(yamlDir);
		expect(manifest.dependencies?.["task-builder"]).toEqual({
			repo: "github.com/company/skills",
			path: "skills/task-builder",
			version: "^2.0.0",
		});

		// Deprecation warning surfaces so the user knows they're on the old extension.
		expect(warnings.some((w) => /skilltree\.yml/i.test(w) && /default extension/i.test(w))).toBe(
			true,
		);
	});
});
