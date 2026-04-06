/**
 * Roundtrip tests: validate that the `skilltree add ...` commands
 * printed by `search` and `info` actually work when executed.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { addCommand } from "../../src/commands/add.js";
import { infoCommand } from "../../src/commands/info.js";
import { searchCommand } from "../../src/commands/search.js";
import { writeRegistryIndex } from "../../src/core/registry-cache.js";
import { writeConfig } from "../../src/core/registry-config.js";
import type { IndexEntry, RegistryIndex } from "../../src/types.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(
		tmpdir(),
		`skilltree-roundtrip-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await mkdir(tempDir, { recursive: true });
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

/** Create a registry index with various entity shapes. */
async function setupRegistry(
	dir: string,
	entities: IndexEntry[],
	registryName = "test-registry",
	repoUrl = "github.com/test-org/test-skills",
): Promise<{ configPath: string; cacheDir: string; projectDir: string }> {
	const configPath = join(dir, "config.yaml");
	const cacheDir = join(dir, "cache");
	const projectDir = join(dir, "project");
	await mkdir(projectDir, { recursive: true });

	await writeConfig({ registries: [{ name: registryName, repo: repoUrl }] }, configPath);

	const index: RegistryIndex = {
		registry: registryName,
		repo: repoUrl,
		updated_at: new Date().toISOString(),
		entities,
	};
	await writeRegistryIndex(index, cacheDir);

	// Create a minimal skilltree.yaml in the project dir
	const { writeFile } = await import("node:fs/promises");
	await writeFile(join(projectDir, "skilltree.yaml"), "dependencies: {}\n");

	return { configPath, cacheDir, projectDir };
}

/** Capture console.log output and return joined string. */
async function captureOutput(fn: () => Promise<void>): Promise<string> {
	const logs: string[] = [];
	const originalLog = console.log;
	console.log = (...args: unknown[]) => logs.push(args.join(" "));
	try {
		await fn();
	} finally {
		console.log = originalLog;
	}
	return logs.join("\n");
}

/**
 * Strip ANSI codes so we can parse the raw command text.
 */
function stripAnsi(s: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: need to match ANSI escape sequences
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Extract all `skilltree add ...` commands from output text.
 * Returns parsed {name, repo, path} for each.
 */
function extractAddCommands(output: string): AddCmd[] {
	const clean = stripAnsi(output);
	const pattern = /→ skilltree add (.+?) --repo (.+?) --path (.+?)$/gm;
	const results: AddCmd[] = [];
	for (const m of clean.matchAll(pattern)) {
		results.push({
			name: (m[1] as string).trim(),
			repo: (m[2] as string).trim(),
			path: (m[3] as string).trim(),
		});
	}
	return results;
}

type AddCmd = { name: string; repo: string; path: string };

/** Find a command by name, failing the test if not found. */
function findCmd(cmds: AddCmd[], name: string): AddCmd {
	const cmd = cmds.find((c) => c.name === name);
	expect(cmd).toBeDefined();
	return cmd as AddCmd;
}

/**
 * Execute the extracted add command against addCommand() and verify the manifest.
 */
async function executeAndVerify(
	cmd: { name: string; repo: string; path: string },
	projectDir: string,
	configPath: string,
	cacheDir: string,
): Promise<void> {
	await addCommand(
		cmd.name,
		{
			repo: cmd.repo,
			path: cmd.path,
			configPath,
			cacheDir,
		},
		projectDir,
	);

	const manifest = parse(await readFile(join(projectDir, "skilltree.yaml"), "utf-8"));
	const dep = manifest.dependencies[cmd.name];
	expect(dep).toBeDefined();
	expect(dep.repo).toBe(cmd.repo);
	expect(dep.path).toBe(cmd.path);
}

// --- Test entities covering common shapes ---

const SIMPLE_SKILL: IndexEntry = {
	name: "python-coding",
	type: "skill",
	path: "skills/python-coding",
	description: "Python best practices",
};

const NESTED_PATH_SKILL: IndexEntry = {
	name: "azure-maps-search-dotnet",
	type: "skill",
	path: ".github/plugins/azure-sdk-dotnet/skills/azure-maps-search-dotnet",
	description: "Azure Maps SDK for .NET",
};

const AGENT_ENTITY: IndexEntry = {
	name: "Planner",
	type: "agent",
	path: ".github/agents/planner.agent.md",
	description: "Planning agent",
};

const HYPHENATED_SKILL: IndexEntry = {
	name: "analyzing-command-and-control-communication",
	type: "skill",
	path: "skills/analyzing-command-and-control-communication",
	description: "C2 analysis",
};

const ALL_ENTITIES = [SIMPLE_SKILL, NESTED_PATH_SKILL, AGENT_ENTITY, HYPHENATED_SKILL];

describe("search suggestion roundtrip", () => {
	test("simple skill name", async () => {
		const dir = await setup();
		const { configPath, cacheDir, projectDir } = await setupRegistry(dir, ALL_ENTITIES);

		const output = await captureOutput(() => searchCommand("python", {}, configPath, cacheDir));

		const cmds = extractAddCommands(output);
		expect(cmds.length).toBeGreaterThanOrEqual(1);

		const cmd = findCmd(cmds, "python-coding");
		await executeAndVerify(cmd, projectDir, configPath, cacheDir);
	});

	test("deeply nested path", async () => {
		const dir = await setup();
		const { configPath, cacheDir, projectDir } = await setupRegistry(dir, ALL_ENTITIES);

		const output = await captureOutput(() => searchCommand("azure", {}, configPath, cacheDir));

		const cmds = extractAddCommands(output);
		const cmd = findCmd(cmds, "azure-maps-search-dotnet");
		expect(cmd.path).toBe(".github/plugins/azure-sdk-dotnet/skills/azure-maps-search-dotnet");
		await executeAndVerify(cmd, projectDir, configPath, cacheDir);
	});

	test("agent entity", async () => {
		const dir = await setup();
		const { configPath, cacheDir, projectDir } = await setupRegistry(dir, ALL_ENTITIES);

		const output = await captureOutput(() => searchCommand("planner", {}, configPath, cacheDir));

		const cmds = extractAddCommands(output);
		const cmd = findCmd(cmds, "Planner");
		await executeAndVerify(cmd, projectDir, configPath, cacheDir);
	});

	test("long hyphenated name", async () => {
		const dir = await setup();
		const { configPath, cacheDir, projectDir } = await setupRegistry(dir, ALL_ENTITIES);

		const output = await captureOutput(() => searchCommand("command", {}, configPath, cacheDir));

		const cmds = extractAddCommands(output);
		const cmd = findCmd(cmds, "analyzing-command-and-control-communication");
		await executeAndVerify(cmd, projectDir, configPath, cacheDir);
	});

	test("all search suggestions are valid add commands", async () => {
		const dir = await setup();
		const { configPath, cacheDir, projectDir } = await setupRegistry(dir, ALL_ENTITIES);

		// Search with empty string to get browse mode (all entities)
		const output = await captureOutput(() => searchCommand("", {}, configPath, cacheDir));

		const cmds = extractAddCommands(output);
		expect(cmds.length).toBe(ALL_ENTITIES.length);

		// Execute each one sequentially (each add to manifest)
		for (const cmd of cmds) {
			await executeAndVerify(cmd, projectDir, configPath, cacheDir);
		}
	});
});

describe("info suggestion roundtrip", () => {
	test("single match produces valid add command", async () => {
		const dir = await setup();
		const { configPath, cacheDir, projectDir } = await setupRegistry(dir, [SIMPLE_SKILL]);

		const output = await captureOutput(() =>
			infoCommand("python-coding", {}, configPath, cacheDir),
		);

		const cmds = extractAddCommands(output);
		expect(cmds.length).toBe(1);
		await executeAndVerify(cmds[0] as AddCmd, projectDir, configPath, cacheDir);
	});

	test("multi-registry match produces valid add commands", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const cacheDir = join(dir, "cache");
		const projectDir = join(dir, "project");
		await mkdir(projectDir, { recursive: true });

		const { writeFile } = await import("node:fs/promises");
		await writeFile(join(projectDir, "skilltree.yaml"), "dependencies: {}\n");

		await writeConfig(
			{
				registries: [
					{ name: "reg-a", repo: "github.com/org-a/skills" },
					{ name: "reg-b", repo: "github.com/org-b/skills" },
				],
			},
			configPath,
		);

		const sharedSkill: IndexEntry = {
			name: "python-coding",
			type: "skill",
			path: "skills/python-coding",
			description: "Python",
		};

		const indexA: RegistryIndex = {
			registry: "reg-a",
			repo: "github.com/org-a/skills",
			updated_at: new Date().toISOString(),
			entities: [sharedSkill],
		};
		const indexB: RegistryIndex = {
			registry: "reg-b",
			repo: "github.com/org-b/skills",
			updated_at: new Date().toISOString(),
			entities: [{ ...sharedSkill, path: "plugins/python/skills/python-coding" }],
		};
		await writeRegistryIndex(indexA, cacheDir);
		await writeRegistryIndex(indexB, cacheDir);

		const output = await captureOutput(() =>
			infoCommand("python-coding", {}, configPath, cacheDir),
		);

		const cmds = extractAddCommands(output);
		expect(cmds.length).toBe(2);

		// Both suggestions should produce valid manifest entries
		// Use separate project dirs since same name can't be added twice
		for (let i = 0; i < cmds.length; i++) {
			const subProject = join(dir, `project-${i}`);
			await mkdir(subProject, { recursive: true });
			await writeFile(join(subProject, "skilltree.yaml"), "dependencies: {}\n");
			await executeAndVerify(cmds[i] as AddCmd, subProject, configPath, cacheDir);
		}
	});

	test("deeply nested path in info output", async () => {
		const dir = await setup();
		const { configPath, cacheDir, projectDir } = await setupRegistry(dir, [NESTED_PATH_SKILL]);

		const output = await captureOutput(() =>
			infoCommand("azure-maps-search-dotnet", {}, configPath, cacheDir),
		);

		const cmds = extractAddCommands(output);
		expect(cmds.length).toBe(1);
		expect((cmds[0] as AddCmd).path).toBe(
			".github/plugins/azure-sdk-dotnet/skills/azure-maps-search-dotnet",
		);
		await executeAndVerify(cmds[0] as AddCmd, projectDir, configPath, cacheDir);
	});
});

describe("edge cases", () => {
	test("name with dots", async () => {
		const dir = await setup();
		const dotEntity: IndexEntry = {
			name: "azure-sdk-v2.0",
			type: "skill",
			path: "skills/azure-sdk-v2.0",
			description: "Azure SDK v2",
		};
		const { configPath, cacheDir, projectDir } = await setupRegistry(dir, [dotEntity]);

		const output = await captureOutput(() => searchCommand("azure", {}, configPath, cacheDir));

		const cmds = extractAddCommands(output);
		expect(cmds.length).toBe(1);
		await executeAndVerify(cmds[0] as AddCmd, projectDir, configPath, cacheDir);
	});

	test("path with leading dot", async () => {
		const dir = await setup();
		const dotPathEntity: IndexEntry = {
			name: "my-skill",
			type: "skill",
			path: ".github/skills/my-skill",
			description: "Dot path skill",
		};
		const { configPath, cacheDir, projectDir } = await setupRegistry(dir, [dotPathEntity]);

		const output = await captureOutput(() => searchCommand("skill", {}, configPath, cacheDir));

		const cmds = extractAddCommands(output);
		expect(cmds.length).toBe(1);
		expect((cmds[0] as AddCmd).path).toBe(".github/skills/my-skill");
		await executeAndVerify(cmds[0] as AddCmd, projectDir, configPath, cacheDir);
	});

	test("repo URL with organization path", async () => {
		const dir = await setup();
		const entity: IndexEntry = {
			name: "secure-code",
			type: "skill",
			path: "plugins/security/skills/secure-code",
			description: "Security skill",
		};
		const { configPath, cacheDir, projectDir } = await setupRegistry(
			dir,
			[entity],
			"security",
			"github.com/trail-of-bits/security-skills",
		);

		const output = await captureOutput(() => searchCommand("secure", {}, configPath, cacheDir));

		const cmds = extractAddCommands(output);
		expect(cmds.length).toBe(1);
		expect((cmds[0] as AddCmd).repo).toBe("github.com/trail-of-bits/security-skills");
		await executeAndVerify(cmds[0] as AddCmd, projectDir, configPath, cacheDir);
	});
});
