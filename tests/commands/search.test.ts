import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { searchCommand } from "../../src/commands/search.js";
import { getRegistryIndexPath, writeRegistryIndex } from "../../src/core/registry-cache.js";
import { writeConfig } from "../../src/core/registry-config.js";
import type { RegistryIndex } from "../../src/types.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(
		tmpdir(),
		`skilltree-searchcmd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await mkdir(tempDir, { recursive: true });
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function setupWithIndex(dir: string): Promise<{ configPath: string; cacheDir: string }> {
	const configPath = join(dir, "config.yaml");
	const cacheDir = join(dir, "cache");

	await writeConfig(
		{ registries: [{ name: "vibes", repo: "github.com/imarios/vibes" }] },
		configPath,
	);

	const index: RegistryIndex = {
		registry: "vibes",
		repo: "github.com/imarios/vibes",
		updated_at: new Date().toISOString(),
		entities: [
			{
				name: "python-coding",
				type: "skill",
				path: "skills/python-coding",
				description: "Python development with Poetry",
				tags: ["python", "testing"],
			},
			{
				name: "task-builder",
				type: "skill",
				path: "skills/task-builder",
				description: "Build security tasks",
				tags: ["security"],
			},
			{
				name: "cybersec-analyst",
				type: "agent",
				path: "agents/cybersec-analyst.md",
				description: "Security investigation agent",
			},
		],
	};
	await writeRegistryIndex(index, cacheDir);

	return { configPath, cacheDir };
}

describe("searchCommand", () => {
	test("outputs matching entities with add commands", async () => {
		const dir = await setup();
		const { configPath, cacheDir } = await setupWithIndex(dir);

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await searchCommand("python", {}, configPath, cacheDir);
		} finally {
			console.log = originalLog;
		}

		const output = logs.join("\n");
		expect(output).toContain("python-coding");
		expect(output).toContain("skilltree add");
	});

	test("search --type filters by entity type", async () => {
		const dir = await setup();
		const { configPath, cacheDir } = await setupWithIndex(dir);

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await searchCommand("security", { type: "agent" }, configPath, cacheDir);
		} finally {
			console.log = originalLog;
		}

		const output = logs.join("\n");
		expect(output).toContain("cybersec-analyst");
		expect(output).not.toContain("task-builder");
	});

	test("search --json outputs valid JSON", async () => {
		const dir = await setup();
		const { configPath, cacheDir } = await setupWithIndex(dir);

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await searchCommand("python", { json: true }, configPath, cacheDir);
		} finally {
			console.log = originalLog;
		}

		const output = logs.join("\n");
		const parsed = JSON.parse(output);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed[0].name).toBe("python-coding");
	});

	test("search with no registries throws with guidance", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await writeConfig({ registries: [] }, configPath);

		await expect(searchCommand("python", {}, configPath)).rejects.toThrow("No registries");
	});

	test("search with never-updated registry throws", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await writeConfig(
			{ registries: [{ name: "vibes", repo: "github.com/imarios/vibes" }] },
			configPath,
		);

		await expect(searchCommand("python", {}, configPath, join(dir, "cache"))).rejects.toThrow(
			"No registry indexes",
		);
	});

	test("search+--registry with empty registry list still names the typo'd flag (issue #42)", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await writeConfig({ registries: [] }, configPath);

		await expect(searchCommand("python", { registry: "ghost" }, configPath)).rejects.toThrow(
			/Registry 'ghost' not found/,
		);
	});

	test("search with unknown --registry names the registry (issue #42)", async () => {
		const dir = await setup();
		const { configPath, cacheDir } = await setupWithIndex(dir);

		// "vibess" is a typo for the configured "vibes". Should NOT bottom out
		// at "No registry indexes available" — the indexes are fine; the name
		// is wrong.
		const promise = searchCommand("python", { registry: "vibess" }, configPath, cacheDir);
		await expect(promise).rejects.toThrow(/Registry 'vibess' not found/);
		await expect(promise).rejects.toThrow(/Did you mean: vibes\?/);
	});

	test("ignores cached indexes that predate the scanner_version field (issue #25)", async () => {
		// Repro: a build from before #25 wrote `index.json` without a
		// `scanner_version` fingerprint. After upgrading skilltree, that cache
		// is logically stale (e.g. it lacks slash-commands from the #21/#24 fix)
		// but its `updated_at` is recent. `searchCommand` must NOT serve it.
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const cacheDir = join(dir, "cache");
		await writeConfig(
			{ registries: [{ name: "vibes", repo: "github.com/imarios/vibes" }] },
			configPath,
		);

		const indexPath = getRegistryIndexPath("vibes", cacheDir);
		await mkdir(dirname(indexPath), { recursive: true });
		const preFixIndex = {
			registry: "vibes",
			repo: "github.com/imarios/vibes",
			updated_at: new Date().toISOString(),
			entities: [{ name: "python-coding", type: "skill", path: "skills/python-coding" }],
		};
		await writeFile(indexPath, JSON.stringify(preFixIndex), "utf-8");

		// Suppress the warn() output during the test.
		const originalWarn = console.warn;
		console.warn = () => {
			// noop — we don't want the warning printed during the assertion
		};
		try {
			await expect(searchCommand("python", {}, configPath, cacheDir)).rejects.toThrow(
				"No registry indexes",
			);
		} finally {
			console.warn = originalWarn;
		}
	});
});
