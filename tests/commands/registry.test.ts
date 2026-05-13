import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import simpleGit from "simple-git";
import {
	DEFAULT_REGISTRIES,
	inferRegistryName,
	OUTDATED_SUFFIX,
	registryAddCommand,
	registryInitCommand,
	registryListCommand,
	registryRemoveCommand,
	registryUpdateCommand,
	resolveRegistryAddUrl,
} from "../../src/commands/registry.js";
import { getRegistryIndexPath, writeRegistryIndex } from "../../src/core/registry-cache.js";
import { readConfig, writeConfig } from "../../src/core/registry-config.js";
import type { RegistryIndex } from "../../src/types.js";
import { createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(tmpdir(), `skilltree-regcmd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	await mkdir(tempDir, { recursive: true });
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("inferRegistryName", () => {
	test("extracts last path segment from URL", () => {
		expect(inferRegistryName("github.com/imarios/vibes")).toBe("vibes");
	});

	test("handles longer paths", () => {
		expect(inferRegistryName("github.com/company/private-skills")).toBe("private-skills");
	});

	test("strips .git suffix", () => {
		expect(inferRegistryName("github.com/imarios/vibes.git")).toBe("vibes");
	});

	test("handles https:// prefix", () => {
		expect(inferRegistryName("https://github.com/imarios/vibes")).toBe("vibes");
	});

	test("handles trailing slash", () => {
		expect(inferRegistryName("github.com/imarios/vibes/")).toBe("vibes");
	});
});

describe("registryAddCommand", () => {
	test("writes entry to config", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await registryAddCommand("github.com/imarios/vibes", {}, configPath);
		const config = await readConfig(configPath);
		expect(config.registries).toHaveLength(1);
		expect(config.registries[0]).toEqual({
			name: "vibes",
			repo: "github.com/imarios/vibes",
		});
	});

	test("infers name from URL", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await registryAddCommand("github.com/company/private-skills", {}, configPath);
		const config = await readConfig(configPath);
		expect(config.registries[0]?.name).toBe("private-skills");
	});

	test("respects --name flag", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await registryAddCommand("github.com/company/private-skills", { name: "internal" }, configPath);
		const config = await readConfig(configPath);
		expect(config.registries[0]?.name).toBe("internal");
	});

	test("strips .git from URL for name inference", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await registryAddCommand("github.com/imarios/vibes.git", {}, configPath);
		const config = await readConfig(configPath);
		expect(config.registries[0]?.name).toBe("vibes");
	});

	test("preserves SSH URL transport info in stored repo", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await registryAddCommand("git@github.com:imarios/vibes", {}, configPath);
		const config = await readConfig(configPath);
		expect(config.registries[0]?.repo).toBe("git@github.com:imarios/vibes");
		expect(config.registries[0]?.name).toBe("vibes");
	});

	test("preserves https:// prefix in stored repo", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await registryAddCommand("https://github.com/imarios/vibes", {}, configPath);
		const config = await readConfig(configPath);
		expect(config.registries[0]?.repo).toBe("https://github.com/imarios/vibes");
	});

	test("errors on duplicate name", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await registryAddCommand("github.com/imarios/vibes", {}, configPath);
		await expect(registryAddCommand("github.com/other/vibes", {}, configPath)).rejects.toThrow(
			"already exists",
		);
	});

	test("errors on duplicate name with --name suggestion in message", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await registryAddCommand("github.com/imarios/vibes", {}, configPath);
		await expect(registryAddCommand("github.com/other/vibes", {}, configPath)).rejects.toThrow(
			"--name",
		);
	});
});

/**
 * The `--repo` alias for the positional URL is wired in `src/cli.ts` (the
 * function still takes a single URL parameter — the CLI layer collapses
 * positional + `--repo` into one). These tests cover the resolver function
 * exposed alongside `registryAddCommand` so the alias logic is unit-testable
 * without spinning up Commander.
 */
describe("resolveRegistryAddUrl", () => {
	test("accepts positional URL only", () => {
		expect(resolveRegistryAddUrl("github.com/foo/bar", undefined)).toBe("github.com/foo/bar");
	});

	test("accepts --repo only", () => {
		expect(resolveRegistryAddUrl(undefined, "github.com/foo/bar")).toBe("github.com/foo/bar");
	});

	test("accepts both when they match exactly (idempotent)", () => {
		expect(resolveRegistryAddUrl("github.com/foo/bar", "github.com/foo/bar")).toBe(
			"github.com/foo/bar",
		);
	});

	test("errors when neither positional nor --repo is provided", () => {
		expect(() => resolveRegistryAddUrl(undefined, undefined)).toThrow(/required/i);
	});

	test("errors when positional and --repo conflict", () => {
		expect(() => resolveRegistryAddUrl("github.com/foo/bar", "github.com/baz/qux")).toThrow(
			/conflict/i,
		);
	});

	test("treats empty string as missing (not silently truthy-skip)", () => {
		// Honours CLAUDE.md "presence check ≠ value check" pattern. A user
		// passing `--repo ""` deserves an explicit error, not a silent fall-
		// through to a positional that wasn't provided.
		expect(() => resolveRegistryAddUrl(undefined, "")).toThrow(/required/i);
		expect(() => resolveRegistryAddUrl("", undefined)).toThrow(/required/i);
		expect(() => resolveRegistryAddUrl("", "")).toThrow(/required/i);
	});
});

describe("registryRemoveCommand", () => {
	test("removes entry and cleans cache", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const cacheDir = join(dir, "cache");

		// Setup: add a registry and create its cache dir
		await writeConfig(
			{ registries: [{ name: "vibes", repo: "github.com/imarios/vibes" }] },
			configPath,
		);
		const registryCacheDir = join(cacheDir, "vibes");
		await mkdir(registryCacheDir, { recursive: true });
		await writeFile(join(registryCacheDir, "index.json"), "{}", "utf-8");

		await registryRemoveCommand("vibes", configPath, cacheDir);

		const config = await readConfig(configPath);
		expect(config.registries).toHaveLength(0);
		expect(existsSync(registryCacheDir)).toBe(false);
	});

	test("errors on nonexistent registry", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await writeConfig({ registries: [] }, configPath);
		await expect(registryRemoveCommand("ghost", configPath)).rejects.toThrow("not found");
	});
});

describe("registryListCommand", () => {
	test("shows all registries with counts and timestamps", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const cacheDir = join(dir, "cache");

		await writeConfig(
			{
				registries: [
					{ name: "vibes", repo: "github.com/imarios/vibes" },
					{ name: "community", repo: "github.com/skilltree/community-skills" },
				],
			},
			configPath,
		);

		// Create an index for vibes
		const index: RegistryIndex = {
			registry: "vibes",
			repo: "github.com/imarios/vibes",
			updated_at: new Date().toISOString(),
			entities: [
				{ name: "python-coding", type: "skill", path: "skills/python-coding" },
				{ name: "task-builder", type: "skill", path: "skills/task-builder" },
			],
		};
		await writeRegistryIndex(index, cacheDir);

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await registryListCommand(configPath, cacheDir);
		} finally {
			console.log = originalLog;
		}

		const output = logs.join("\n");
		expect(output).toContain("vibes");
		expect(output).toContain("community");
		expect(output).toContain("github.com/imarios/vibes");
	});

	test("annotates outdated caches (scanner_version mismatch) so users see they need to update", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const cacheDir = join(dir, "cache");

		await writeConfig(
			{ registries: [{ name: "vibes", repo: "github.com/imarios/vibes" }] },
			configPath,
		);

		// Hand-write a cache without scanner_version (pre-#25 shape).
		const indexPath = getRegistryIndexPath("vibes", cacheDir);
		await mkdir(dirname(indexPath), { recursive: true });
		const stale = {
			registry: "vibes",
			repo: "github.com/imarios/vibes",
			updated_at: new Date().toISOString(),
			entities: [{ name: "python-coding", type: "skill", path: "skills/python-coding" }],
		};
		await writeFile(indexPath, JSON.stringify(stale), "utf-8");

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await registryListCommand(configPath, cacheDir);
		} finally {
			console.log = originalLog;
		}

		const output = logs.join("\n");
		expect(output).toContain("vibes");
		expect(output).toContain(OUTDATED_SUFFIX);
	});

	test("shows message when no registries configured", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await writeConfig({ registries: [] }, configPath);

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await registryListCommand(configPath);
		} finally {
			console.log = originalLog;
		}

		const output = logs.join("\n");
		expect(output.toLowerCase()).toContain("no registries");
	});
});

describe("registryUpdateCommand", () => {
	test("--json emits a result array per touched registry", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const cacheDir = join(dir, "cache");

		// Build a real local repo and bare clone of it
		const repoDir = await createTestRepo(dir, "repo", [
			{ path: "skills/a", name: "a" },
			{ path: "skills/b", name: "b" },
			{ path: "agents/x.md", name: "x", isAgent: true },
		]);
		const bareDir = join(dir, "bare.git");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		await writeConfig({ registries: [{ name: "fixture", repo: `file://${bareDir}` }] }, configPath);

		const logs: string[] = [];
		const originalLog = console.log;
		const originalWrite = process.stdout.write;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		process.stdout.write = () => true;
		try {
			await registryUpdateCommand(undefined, configPath, cacheDir, { json: true });
		} finally {
			console.log = originalLog;
			process.stdout.write = originalWrite;
		}

		expect(logs).toHaveLength(1);
		const parsed = JSON.parse(logs[0] ?? "");
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed).toHaveLength(1);
		const result = parsed[0];
		expect(result.name).toBe("fixture");
		expect(result.repo).toBe(`file://${bareDir}`);
		expect(typeof result.entities).toBe("number");
		expect(result.entities).toBe(3);
		expect(result.skills).toBe(2);
		expect(result.agents).toBe(1);
		expect(result.commands).toBe(0);
	});

	test("--json emits [] when no registries configured", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await writeConfig({ registries: [] }, configPath);

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await registryUpdateCommand(undefined, configPath, undefined, { json: true });
		} finally {
			console.log = originalLog;
		}

		expect(logs).toHaveLength(1);
		expect(JSON.parse(logs[0] ?? "")).toEqual([]);
	});
});

describe("registryInitCommand", () => {
	test("adds all default registries", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");

		const logs: string[] = [];
		const originalLog = console.log;
		const originalWrite = process.stdout.write;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		process.stdout.write = () => true;
		try {
			await registryInitCommand({ skipUpdate: true }, configPath);
		} finally {
			console.log = originalLog;
			process.stdout.write = originalWrite;
		}

		const config = await readConfig(configPath);
		expect(config.registries).toHaveLength(DEFAULT_REGISTRIES.length);
		for (const reg of DEFAULT_REGISTRIES) {
			expect(
				config.registries.find((r) => r.name === reg.name && r.repo === reg.repo),
			).toBeTruthy();
		}
	});

	test("skips registries that already exist by name", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");

		// Pre-add one registry with a matching name but different repo
		await writeConfig(
			{ registries: [{ name: "trailofbits", repo: "github.com/other/repo" }] },
			configPath,
		);

		const logs: string[] = [];
		const originalLog = console.log;
		const originalWrite = process.stdout.write;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		process.stdout.write = () => true;
		try {
			await registryInitCommand({ skipUpdate: true }, configPath);
		} finally {
			console.log = originalLog;
			process.stdout.write = originalWrite;
		}

		const config = await readConfig(configPath);
		// Original + remaining new ones (trailofbits skipped)
		expect(config.registries).toHaveLength(DEFAULT_REGISTRIES.length);
		// Original repo preserved, not overwritten
		expect(config.registries.find((r) => r.name === "trailofbits")?.repo).toBe(
			"github.com/other/repo",
		);
		const output = logs.join("\n");
		expect(output).toContain("trailofbits");
		expect(output).toContain("Skipped");
	});

	test("skips registries that already exist by repo URL", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");

		// Pre-add one registry with matching repo but different name
		await writeConfig(
			{
				registries: [{ name: "my-security", repo: "github.com/trailofbits/skills" }],
			},
			configPath,
		);

		const logs: string[] = [];
		const originalLog = console.log;
		const originalWrite = process.stdout.write;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		process.stdout.write = () => true;
		try {
			await registryInitCommand({ skipUpdate: true }, configPath);
		} finally {
			console.log = originalLog;
			process.stdout.write = originalWrite;
		}

		const config = await readConfig(configPath);
		// trailofbits skipped (repo match), but name "trailofbits" not added
		expect(
			config.registries.filter((r) => r.repo === "github.com/trailofbits/skills"),
		).toHaveLength(1);
		expect(config.registries.find((r) => r.repo === "github.com/trailofbits/skills")?.name).toBe(
			"my-security",
		);
	});

	test("reports when all registries already configured", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");

		// Pre-add all defaults
		await writeConfig({ registries: [...DEFAULT_REGISTRIES] }, configPath);

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await registryInitCommand({ skipUpdate: true }, configPath);
		} finally {
			console.log = originalLog;
		}

		const output = logs.join("\n");
		expect(output).toContain("already configured");
	});

	test("prints update hint with --skip-update", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await registryInitCommand({ skipUpdate: true }, configPath);
		} finally {
			console.log = originalLog;
		}

		const output = logs.join("\n");
		expect(output).toContain("skilltree registry update");
	});
});
