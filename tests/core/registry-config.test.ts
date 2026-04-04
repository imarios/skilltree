import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	addRegistry,
	listRegistries,
	readConfig,
	removeRegistry,
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
    repo: github.com/skillkit/community-skills
`,
			"utf-8",
		);
		const config = await readConfig(configPath);
		expect(config.registries).toEqual([
			{ name: "vibes", repo: "github.com/imarios/vibes" },
			{ name: "community", repo: "github.com/skillkit/community-skills" },
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
		await addRegistry("community", "github.com/skillkit/community-skills", configPath);
		const config = await readConfig(configPath);
		expect(config.registries).toHaveLength(2);
		expect(config.registries[1]).toEqual({
			name: "community",
			repo: "github.com/skillkit/community-skills",
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
					{ name: "community", repo: "github.com/skillkit/community-skills" },
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
