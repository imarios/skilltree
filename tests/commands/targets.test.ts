import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	targetsAddCommand,
	targetsDetectCommand,
	targetsListCommand,
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
	await writeFile(join(dir, "skilltree.yml"), content, "utf-8");
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

describe("targetsListCommand", () => {
	test("--json emits an array of {name, path, detected, configured} rows", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(dir, "install_targets:\n  - claude\ndependencies: {}\n");

		// Empty fake home so nothing is "detected"
		const fakeHome = join(dir, "fake-home");
		await mkdir(fakeHome, { recursive: true });

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await targetsListCommand(dir, { json: true, homeDir: fakeHome });
		} finally {
			console.log = originalLog;
		}

		expect(logs).toHaveLength(1);
		const parsed = JSON.parse(logs[0] ?? "");
		expect(Array.isArray(parsed)).toBe(true);
		// Should include at least claude (configured) and any other known agents (not configured)
		const claude = parsed.find((r: { name: string }) => r.name === "claude");
		expect(claude).toBeDefined();
		expect(claude.configured).toBe(true);
		expect(claude.detected).toBe(false);
		expect(typeof claude.path).toBe("string");
		// Every row has the four fields with the right types
		for (const row of parsed) {
			expect(typeof row.name).toBe("string");
			expect(typeof row.path).toBe("string");
			expect(typeof row.detected).toBe("boolean");
			expect(typeof row.configured).toBe("boolean");
		}
	});

	test("--json dedupes hand-edited duplicate custom paths", async () => {
		const dir = await makeTempDir();
		// User-authored manifest with a repeated custom path. `targetsAddCommand`
		// rejects this on insert, but a manually-edited YAML file can still
		// reach the list path — the renderer must not double-emit.
		await writeManifestFile(
			dir,
			"install_targets:\n  - claude\n  - ./custom-a\n  - ./custom-a\ndependencies: {}\n",
		);
		const fakeHome = join(dir, "fake-home");
		await mkdir(fakeHome, { recursive: true });

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await targetsListCommand(dir, { json: true, homeDir: fakeHome });
		} finally {
			console.log = originalLog;
		}

		const parsed = JSON.parse(logs[0] ?? "");
		const customRows = parsed.filter((r: { name: string }) => r.name === "./custom-a");
		expect(customRows).toHaveLength(1);
	});

	test("--json includes custom path targets", async () => {
		const dir = await makeTempDir();
		await writeManifestFile(
			dir,
			"install_targets:\n  - claude\n  - ./my-custom\ndependencies: {}\n",
		);
		const fakeHome = join(dir, "fake-home");
		await mkdir(fakeHome, { recursive: true });

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await targetsListCommand(dir, { json: true, homeDir: fakeHome });
		} finally {
			console.log = originalLog;
		}

		const parsed = JSON.parse(logs[0] ?? "");
		const custom = parsed.find((r: { name: string }) => r.name === "./my-custom");
		expect(custom).toBeDefined();
		expect(custom.configured).toBe(true);
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

describe("targets ↔ .gitignore sync (issue #33)", () => {
	async function readGitignore(dir: string): Promise<string> {
		return readFile(join(dir, ".gitignore"), "utf-8");
	}

	async function gitignoreExists(dir: string): Promise<boolean> {
		try {
			await stat(join(dir, ".gitignore"));
			return true;
		} catch {
			return false;
		}
	}

	describe("targetsAddCommand", () => {
		test("adds the new target's entries to .gitignore (codex → .agents/)", async () => {
			// Regression: targets add was disconnected from gitignore, so files
			// installed under the new target's dir got committed.
			const dir = await makeTempDir();
			await writeManifestFile(dir, "install_targets:\n  - claude\ndependencies: {}\n");
			await writeFile(
				join(dir, ".gitignore"),
				".claude/skills/\n.claude/agents/\n.claude/commands/\n",
			);

			await targetsAddCommand("codex", dir);

			const content = await readGitignore(dir);
			expect(content).toContain(".agents/skills/");
			expect(content).toContain(".agents/agents/");
			expect(content).toContain(".agents/commands/");
		});

		test("adds a literal-path target's entries to .gitignore", async () => {
			const dir = await makeTempDir();
			await writeManifestFile(dir, "install_targets:\n  - claude\ndependencies: {}\n");
			await writeFile(join(dir, ".gitignore"), ".claude/skills/\n");

			await targetsAddCommand("./custom", dir);

			const content = await readGitignore(dir);
			expect(content).toContain("./custom/skills/");
			expect(content).toContain("./custom/agents/");
			expect(content).toContain("./custom/commands/");
		});

		test("creates .gitignore if absent", async () => {
			const dir = await makeTempDir();
			await writeManifestFile(dir, "install_targets:\n  - claude\ndependencies: {}\n");
			expect(await gitignoreExists(dir)).toBe(false);

			await targetsAddCommand("codex", dir);

			expect(await gitignoreExists(dir)).toBe(true);
			const content = await readGitignore(dir);
			expect(content).toContain(".agents/skills/");
		});

		test("idempotent: re-adding a target after remove does not duplicate gitignore lines", async () => {
			const dir = await makeTempDir();
			await writeManifestFile(dir, "install_targets:\n  - claude\n  - codex\ndependencies: {}\n");
			await writeFile(
				join(dir, ".gitignore"),
				".claude/skills/\n.claude/agents/\n.claude/commands/\n.agents/skills/\n.agents/agents/\n.agents/commands/\n",
			);

			await targetsRemoveCommand("codex", dir);
			await targetsAddCommand("codex", dir);

			const content = await readGitignore(dir);
			const matches = content.match(/^\.agents\/skills\/$/gm);
			expect(matches?.length).toBe(1);
		});
	});

	describe("targetsRemoveCommand", () => {
		test("removes the target's entries from .gitignore", async () => {
			const dir = await makeTempDir();
			await writeManifestFile(dir, "install_targets:\n  - claude\n  - codex\ndependencies: {}\n");
			await writeFile(
				join(dir, ".gitignore"),
				".claude/skills/\n.claude/agents/\n.claude/commands/\n.agents/skills/\n.agents/agents/\n.agents/commands/\n",
			);

			await targetsRemoveCommand("codex", dir);

			const content = await readGitignore(dir);
			expect(content).not.toContain(".agents/skills/");
			expect(content).not.toContain(".agents/agents/");
			expect(content).not.toContain(".agents/commands/");
			// claude entries preserved
			expect(content).toContain(".claude/skills/");
		});

		test("preserves entries still owned by another remaining target", async () => {
			// If a literal path target happens to point at the same dir as a
			// known agent (e.g., user added `./.claude` plus `claude`), removing
			// one must NOT yank the entry the other still needs.
			const dir = await makeTempDir();
			await writeManifestFile(
				dir,
				"install_targets:\n  - claude\n  - ./.claude\ndependencies: {}\n",
			);
			await writeFile(
				join(dir, ".gitignore"),
				".claude/skills/\n.claude/agents/\n.claude/commands/\n",
			);

			await targetsRemoveCommand("./.claude", dir);

			const content = await readGitignore(dir);
			// Still owned by `claude`
			expect(content).toContain(".claude/skills/");
		});

		test("does not create .gitignore if absent (no-op when the file isn't there)", async () => {
			const dir = await makeTempDir();
			await writeManifestFile(dir, "install_targets:\n  - claude\n  - codex\ndependencies: {}\n");
			// No .gitignore file exists
			expect(await gitignoreExists(dir)).toBe(false);

			await targetsRemoveCommand("codex", dir);

			expect(await gitignoreExists(dir)).toBe(false);
		});

		test("no-op for gitignore when target's entries aren't present", async () => {
			// User hand-edited .gitignore and removed the codex entries already.
			// Removing codex from manifest must not error or scramble the file.
			const dir = await makeTempDir();
			await writeManifestFile(dir, "install_targets:\n  - claude\n  - codex\ndependencies: {}\n");
			const initial = ".claude/skills/\n.claude/agents/\n.claude/commands/\n";
			await writeFile(join(dir, ".gitignore"), initial);

			await targetsRemoveCommand("codex", dir);

			const content = await readGitignore(dir);
			expect(content).toBe(initial);
		});
	});

	describe("targetsDetectCommand", () => {
		test("adds gitignore entries for newly detected agents", async () => {
			// Same root cause as add/remove: detect was mutating install_targets
			// without ever touching .gitignore.
			const dir = await makeTempDir();
			await writeManifestFile(dir, "install_targets:\n  - claude\ndependencies: {}\n");
			await writeFile(
				join(dir, ".gitignore"),
				".claude/skills/\n.claude/agents/\n.claude/commands/\n",
			);

			const fakeHome = join(dir, "fake-home");
			await mkdir(join(fakeHome, ".claude"), { recursive: true });
			await mkdir(join(fakeHome, ".codex"), { recursive: true });

			await targetsDetectCommand(dir, { homeDir: fakeHome });

			const content = await readGitignore(dir);
			expect(content).toContain(".agents/skills/");
			expect(content).toContain(".agents/agents/");
			expect(content).toContain(".agents/commands/");
		});
	});
});
