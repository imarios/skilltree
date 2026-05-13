import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	addRegistry,
	assertKnownRegistry,
	listRegistries,
	readConfig,
	removeRegistry,
	unknownRegistryError,
	writeConfig,
} from "../../src/core/registry-config.js";
import type { RegistryConfig } from "../../src/types.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(
		tmpdir(),
		`skilltree-regconfig-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await mkdir(tempDir, { recursive: true });
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("readConfig", () => {
	test("returns empty registries when config file does not exist", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const config = await readConfig(configPath);
		expect(config.registries).toEqual([]);
	});

	test("parses valid config.yaml with multiple registries", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await writeFile(
			configPath,
			`registries:
  - name: vibes
    repo: github.com/imarios/vibes
  - name: community
    repo: github.com/skilltree/community-skills
`,
			"utf-8",
		);
		const config = await readConfig(configPath);
		expect(config.registries).toEqual([
			{ name: "vibes", repo: "github.com/imarios/vibes" },
			{ name: "community", repo: "github.com/skilltree/community-skills" },
		]);
	});

	test("handles empty file gracefully", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await writeFile(configPath, "", "utf-8");
		const config = await readConfig(configPath);
		expect(config.registries).toEqual([]);
	});

	test("handles file with no registries key gracefully", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await writeFile(configPath, "something_else: true\n", "utf-8");
		const config = await readConfig(configPath);
		expect(config.registries).toEqual([]);
	});
});

describe("writeConfig", () => {
	test("creates config file and parent dirs", async () => {
		const dir = await setup();
		const configPath = join(dir, "nested", "deep", "config.yaml");
		const config: RegistryConfig = {
			registries: [{ name: "vibes", repo: "github.com/imarios/vibes" }],
		};
		await writeConfig(config, configPath);
		const content = await readFile(configPath, "utf-8");
		expect(content).toContain("vibes");
		expect(content).toContain("github.com/imarios/vibes");
	});

	test("serializes registries correctly", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const config: RegistryConfig = {
			registries: [
				{ name: "vibes", repo: "github.com/imarios/vibes" },
				{ name: "internal", repo: "github.com/company/private-skills" },
			],
		};
		await writeConfig(config, configPath);
		// Read it back to verify round-trip
		const readBack = await readConfig(configPath);
		expect(readBack.registries).toEqual(config.registries);
	});
});

describe("addRegistry", () => {
	test("appends a new registry entry", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		// Seed with one registry
		await writeConfig(
			{ registries: [{ name: "vibes", repo: "github.com/imarios/vibes" }] },
			configPath,
		);
		await addRegistry("community", "github.com/skilltree/community-skills", configPath);
		const config = await readConfig(configPath);
		expect(config.registries).toHaveLength(2);
		expect(config.registries[1]).toEqual({
			name: "community",
			repo: "github.com/skilltree/community-skills",
		});
	});

	test("creates config file on first use", async () => {
		const dir = await setup();
		const configPath = join(dir, "new-config.yaml");
		await addRegistry("vibes", "github.com/imarios/vibes", configPath);
		const config = await readConfig(configPath);
		expect(config.registries).toEqual([{ name: "vibes", repo: "github.com/imarios/vibes" }]);
	});

	test("errors on duplicate name", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await addRegistry("vibes", "github.com/imarios/vibes", configPath);
		await expect(addRegistry("vibes", "github.com/other/repo", configPath)).rejects.toThrow(
			"already exists",
		);
	});
});

describe("removeRegistry", () => {
	test("removes an existing entry by name", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await writeConfig(
			{
				registries: [
					{ name: "vibes", repo: "github.com/imarios/vibes" },
					{ name: "community", repo: "github.com/skilltree/community-skills" },
				],
			},
			configPath,
		);
		await removeRegistry("vibes", configPath);
		const config = await readConfig(configPath);
		expect(config.registries).toHaveLength(1);
		expect(config.registries[0]?.name).toBe("community");
	});

	test("errors on nonexistent name", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await writeConfig({ registries: [] }, configPath);
		await expect(removeRegistry("ghost", configPath)).rejects.toThrow("not found");
	});
});

describe("unknownRegistryError (issue #42)", () => {
	const registries = [
		{ name: "vibes", repo: "github.com/imarios/vibes" },
		{ name: "agent-skills", repo: "github.com/voltagent/agent-skills" },
		{ name: "internal", repo: "github.com/company/private" },
	];

	test("includes the typed name and the configured names", () => {
		const err = unknownRegistryError("ghost", registries);
		expect(err).toBeInstanceOf(Error);
		expect(err.message).toContain("'ghost'");
		expect(err.message).toContain("vibes");
		expect(err.message).toContain("agent-skills");
		expect(err.message).toContain("internal");
	});

	test("special-cases the empty configured list with actionable guidance", () => {
		const err = unknownRegistryError("ghost", []);
		expect(err.message).toContain("'ghost'");
		expect(err.message).toContain("No registries are configured");
		expect(err.message).toContain("registry add");
		expect(err.message).not.toContain("Did you mean");
	});

	// Parametrized: each row exercises the suggestion threshold at a single
	// boundary. Add new rows when a real-world typo escapes the heuristic.
	const suggestionCases: Array<{
		typed: string;
		expectSuggestion: string | null;
		why: string;
	}> = [
		{ typed: "agent-skill", expectSuggestion: "agent-skills", why: "distance 1 (missing char)" },
		{ typed: "vibess", expectSuggestion: "vibes", why: "distance 1 (extra char)" },
		{ typed: "vibse", expectSuggestion: "vibes", why: "distance 2 (transposition)" },
		{ typed: "agent-Skill", expectSuggestion: "agent-skills", why: "distance 2 (case + missing)" },
		{
			typed: "totally-unrelated-xyz",
			expectSuggestion: null,
			why: "distance ≫ 2 — no suggestion",
		},
		{ typed: "z", expectSuggestion: null, why: "single char too far from any name" },
		{ typed: "", expectSuggestion: null, why: "empty input never suggests" },
	];

	for (const { typed, expectSuggestion, why } of suggestionCases) {
		test(`suggestion for "${typed}" — ${why}`, () => {
			const msg = unknownRegistryError(typed, registries).message;
			if (expectSuggestion) {
				expect(msg).toContain(`Did you mean: ${expectSuggestion}?`);
			} else {
				expect(msg).not.toContain("Did you mean");
			}
		});
	}

	test("ties: closest by first-match wins (deterministic suggestion)", () => {
		// Two configured names equidistant from the typed value. The helper
		// uses strict `<` so the first wins, which mirrors the CLI's
		// general "first-registry wins" stance for cross-registry collisions.
		const ties = [
			{ name: "alpha", repo: "github.com/x/alpha" },
			{ name: "alphz", repo: "github.com/x/alphz" }, // distance 1 from "alpha?"
		];
		const msg = unknownRegistryError("alphx", ties).message;
		expect(msg).toContain("Did you mean: alpha?");
	});
});

describe("assertKnownRegistry (issue #42)", () => {
	const registries = [
		{ name: "vibes", repo: "github.com/imarios/vibes" },
		{ name: "internal", repo: "github.com/company/private" },
	];

	test("no-op when name is undefined", () => {
		expect(() => assertKnownRegistry(undefined, registries)).not.toThrow();
	});

	test("no-op when name is among the configured registries", () => {
		expect(() => assertKnownRegistry("vibes", registries)).not.toThrow();
	});

	test("throws unknownRegistryError for a typo'd name", () => {
		expect(() => assertKnownRegistry("vibess", registries)).toThrow(/Registry 'vibess' not found/);
	});
});

describe("listRegistries", () => {
	test("returns all entries from config", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		await writeConfig(
			{
				registries: [
					{ name: "vibes", repo: "github.com/imarios/vibes" },
					{ name: "internal", repo: "github.com/company/private" },
				],
			},
			configPath,
		);
		const entries = await listRegistries(configPath);
		expect(entries).toHaveLength(2);
		expect(entries[0]?.name).toBe("vibes");
		expect(entries[1]?.name).toBe("internal");
	});
});
