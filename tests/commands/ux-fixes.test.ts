/**
 * Tests for all 18 UX issues found during user testing.
 * Each test group corresponds to a numbered fix.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addCommand } from "../../src/commands/add.js";
import { infoCommand } from "../../src/commands/info.js";
import { initCommand } from "../../src/commands/init.js";
import { registryAddCommand } from "../../src/commands/registry.js";
import { searchCommand } from "../../src/commands/search.js";
import { writeRegistryIndex } from "../../src/core/registry-cache.js";
import { addRegistry, writeConfig } from "../../src/core/registry-config.js";
import { dynamicScanRepo } from "../../src/core/registry-scanner.js";
import { scoreEntity, searchRegistries } from "../../src/core/registry-search.js";
import type { IndexEntry, RegistryIndex } from "../../src/types.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(tmpdir(), `skilltree-uxfix-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	await mkdir(tempDir, { recursive: true });
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

// --- Fix #1: init should not overwrite existing skilltree.yaml ---
describe("Fix #1: init overwrite guard", () => {
	test("init refuses to overwrite existing skilltree.yaml", async () => {
		const dir = await setup();
		await initCommand(dir);
		// Add a dependency manually
		const manifestPath = join(dir, "skilltree.yaml");
		const content = await readFile(manifestPath, "utf-8");
		await writeFile(
			manifestPath,
			content.replace(
				"dependencies: {}",
				"dependencies:\n  my-skill:\n    local: ./skills/my-skill",
			),
			"utf-8",
		);

		// Second init should not wipe dependencies
		await expect(initCommand(dir)).rejects.toThrow("already exists");
	});
});

// --- Fix #4: registry add duplicate URL warning ---
describe("Fix #4: duplicate URL warning", () => {
	test("addRegistry warns on duplicate repo URL", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await addRegistry("alpha", "github.com/org/repo", configPath);
		await expect(addRegistry("beta", "github.com/org/repo", configPath)).rejects.toThrow(
			"already registered",
		);
	});
});

// --- Fix #5: registry add hints to update ---
describe("Fix #5: registry add update hint", () => {
	test("registryAddCommand prints update hint", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const logs: string[] = [];
		const orig = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await registryAddCommand("github.com/org/repo", {}, configPath);
		} finally {
			console.log = orig;
		}
		const output = logs.join("\n");
		expect(output).toContain("registry update");
	});
});

// --- Fix #6: exit codes for no results ---
describe("Fix #6: search/info exit codes", () => {
	test("searchCommand throws when no results found (non-json)", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const cacheDir = join(dir, "cache");
		await writeConfig({ registries: [{ name: "r", repo: "x" }] }, configPath);
		const index: RegistryIndex = {
			registry: "r",
			repo: "x",
			updated_at: new Date().toISOString(),
			entities: [{ name: "python-coding", type: "skill", path: "skills/python-coding" }],
		};
		await writeRegistryIndex(index, cacheDir);

		await expect(searchCommand("nonexistent", {}, configPath, cacheDir)).rejects.toThrow(
			"No results",
		);
	});

	test("infoCommand throws when entity not found", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const cacheDir = join(dir, "cache");
		await writeConfig({ registries: [{ name: "r", repo: "x" }] }, configPath);
		const index: RegistryIndex = {
			registry: "r",
			repo: "x",
			updated_at: new Date().toISOString(),
			entities: [],
		};
		await writeRegistryIndex(index, cacheDir);

		await expect(infoCommand("nonexistent", {}, configPath, cacheDir)).rejects.toThrow("not found");
	});
});

// --- Fix #8: registry list --json entities as number ---
describe("Fix #8: registry list JSON types", () => {
	test("registry list --json returns entities as number", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const cacheDir = join(dir, "cache");
		await writeConfig({ registries: [{ name: "r", repo: "x" }] }, configPath);
		const index: RegistryIndex = {
			registry: "r",
			repo: "x",
			updated_at: new Date().toISOString(),
			entities: [
				{ name: "a", type: "skill", path: "skills/a" },
				{ name: "b", type: "skill", path: "skills/b" },
			],
		};
		await writeRegistryIndex(index, cacheDir);

		const { registryListCommand } = await import("../../src/commands/registry.js");
		const logs: string[] = [];
		const orig = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await registryListCommand(configPath, cacheDir, { json: true });
		} finally {
			console.log = orig;
		}
		const parsed = JSON.parse(logs.join("\n"));
		expect(typeof parsed[0].entities).toBe("number");
		expect(parsed[0].entities).toBe(2);
	});

	test("registry list --json returns null for never-updated registry", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await writeConfig({ registries: [{ name: "r", repo: "x" }] }, configPath);

		const { registryListCommand } = await import("../../src/commands/registry.js");
		const logs: string[] = [];
		const orig = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await registryListCommand(configPath, join(dir, "empty-cache"), { json: true });
		} finally {
			console.log = orig;
		}
		const parsed = JSON.parse(logs.join("\n"));
		expect(parsed[0].entities).toBeNull();
		expect(parsed[0].updated_at).toBeNull();
	});
});

// --- Fix #10: short tokens too loose ---
describe("Fix #10: short token description matching", () => {
	test("2-letter token does not match inside description words", () => {
		const entity: IndexEntry = {
			name: "rust-coding",
			type: "skill",
			path: "skills/rust-coding",
			description: "Rust development with Cargo workspaces",
		};
		// "go" should NOT match "Cargo" in description
		const score = scoreEntity(["go"], entity);
		expect(score).toBe(0);
	});

	test("3+ letter token still matches description substring", () => {
		const entity: IndexEntry = {
			name: "rust-coding",
			type: "skill",
			path: "skills/rust-coding",
			description: "Rust development with Cargo workspaces",
		};
		const score = scoreEntity(["cargo"], entity);
		expect(score).toBeGreaterThan(0);
	});
});

// --- Fix #11: add validates semver ---
describe("Fix #11: add validates semver", () => {
	test("add rejects invalid semver constraint", async () => {
		const dir = await setup();
		await initCommand(dir);
		await expect(
			addCommand(
				"some-skill",
				{ repo: "github.com/x/y", path: "skills/s", version: "not-a-version" },
				dir,
			),
		).rejects.toThrow("Invalid version");
	});

	test("add accepts valid semver constraint", async () => {
		const dir = await setup();
		await initCommand(dir);
		// Should not throw
		await addCommand(
			"some-skill",
			{ repo: "github.com/x/y", path: "skills/s", version: "^2.0.0" },
			dir,
		);
	});
});

// --- Fix #13: search with empty query lists everything ---
describe("Fix #13: search --all / empty query", () => {
	test("empty query returns all entities", () => {
		const index: RegistryIndex = {
			registry: "r",
			repo: "x",
			updated_at: new Date().toISOString(),
			entities: [
				{ name: "a", type: "skill", path: "a" },
				{ name: "b", type: "agent", path: "b" },
			],
		};
		const results = searchRegistries("", [index]);
		expect(results).toHaveLength(2);
	});
});

// --- Fix #14: search --registry skips irrelevant warnings ---
describe("Fix #14: search --registry skips irrelevant warnings", () => {
	test("search --registry does not warn about other registries", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const cacheDir = join(dir, "cache");
		await writeConfig(
			{
				registries: [
					{ name: "alpha", repo: "x" },
					{ name: "beta", repo: "y" },
				],
			},
			configPath,
		);
		// Only alpha has an index
		const index: RegistryIndex = {
			registry: "alpha",
			repo: "x",
			updated_at: new Date().toISOString(),
			entities: [{ name: "skill-a", type: "skill", path: "a" }],
		};
		await writeRegistryIndex(index, cacheDir);

		const warns: string[] = [];
		const origWarn = console.warn;
		console.warn = (...args: unknown[]) => warns.push(args.join(" "));
		const logs: string[] = [];
		const origLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await searchCommand("skill-a", { registry: "alpha" }, configPath, cacheDir);
		} finally {
			console.warn = origWarn;
			console.log = origLog;
		}
		// Should NOT see any warning about beta
		expect(warns.some((w) => w.includes("beta"))).toBe(false);
	});
});

// --- Fix #18: dedup entities by name ---
describe("Fix #18: scanner deduplicates entities by name", () => {
	test("dynamicScanRepo deduplicates skills with same name at different paths", async () => {
		const dir = await setup();
		// Create a repo where the same skill name appears at two paths
		const simpleGit = (await import("simple-git")).default;
		const sourceDir = join(dir, "source");
		await mkdir(join(sourceDir, "skills", "my-skill"), { recursive: true });
		await mkdir(join(sourceDir, ".claude", "skills", "my-skill"), { recursive: true });
		await writeFile(
			join(sourceDir, "skills", "my-skill", "SKILL.md"),
			"---\nname: my-skill\n---\n\n# Content\n",
		);
		await writeFile(
			join(sourceDir, ".claude", "skills", "my-skill", "SKILL.md"),
			"---\nname: my-skill\n---\n\n# Content\n",
		);
		const git = simpleGit(sourceDir);
		await git.init();
		await git.addConfig("user.email", "t@t.com");
		await git.addConfig("user.name", "T");
		await git.add(".");
		await git.commit("init");
		const bareDir = join(dir, "bare");
		await simpleGit().clone(sourceDir, bareDir, ["--bare"]);

		const entries = await dynamicScanRepo(bareDir);
		const names = entries.map((e) => e.name);
		const uniqueNames = new Set(names);
		expect(names.length).toBe(uniqueNames.size);
	});
});
