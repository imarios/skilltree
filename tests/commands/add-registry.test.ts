import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { addCommand } from "../../src/commands/add.js";
import { initCommand } from "../../src/commands/init.js";
import { writeRegistryIndex } from "../../src/core/registry-cache.js";
import { writeConfig } from "../../src/core/registry-config.js";
import {
	isLocalDependency,
	isRemoteDependency,
	type Manifest,
	type RegistryIndex,
} from "../../src/types.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(tmpdir(), `skilltree-addreg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	await mkdir(tempDir, { recursive: true });
	await initCommand(tempDir);
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function setupWithRegistry(dir: string): Promise<{ configPath: string; cacheDir: string }> {
	const configPath = join(dir, ".skilltree-config.yaml");
	const cacheDir = join(dir, ".skilltree-cache");

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
				description: "Python development",
			},
			{
				name: "task-builder",
				type: "skill",
				path: "skills/task-builder",
				description: "Build tasks",
			},
		],
	};
	await writeRegistryIndex(index, cacheDir);

	return { configPath, cacheDir };
}

async function readManifestRaw(dir: string): Promise<Manifest> {
	const content = await readFile(join(dir, "skilltree.yml"), "utf-8");
	return YAML.parse(content) as Manifest;
}

describe("registry-assisted add", () => {
	test("resolves from registry and writes full form to manifest", async () => {
		const dir = await setup();
		const { configPath, cacheDir } = await setupWithRegistry(dir);

		await addCommand("python-coding", { configPath, cacheDir }, dir);

		const manifest = await readManifestRaw(dir);
		const dep = manifest.dependencies?.["python-coding"];
		expect(dep).toBeDefined();
		expect(dep && isRemoteDependency(dep)).toBe(true);
		if (dep && isRemoteDependency(dep)) {
			expect(dep.repo).toBe("github.com/imarios/vibes");
			expect(dep.path).toBe("skills/python-coding");
		}
	});

	test("errors when no registries configured", async () => {
		const dir = await setup();
		const configPath = join(dir, ".skilltree-config.yaml");
		await writeConfig({ registries: [] }, configPath);

		await expect(addCommand("python-coding", { configPath }, dir)).rejects.toThrow("no registries");
	});

	test("errors when name not found in any registry", async () => {
		const dir = await setup();
		const { configPath, cacheDir } = await setupWithRegistry(dir);

		await expect(addCommand("nonexistent-skill", { configPath, cacheDir }, dir)).rejects.toThrow(
			"not found",
		);
	});

	test("errors when registry indexes not available", async () => {
		const dir = await setup();
		const configPath = join(dir, ".skilltree-config.yaml");
		const cacheDir = join(dir, ".skilltree-cache-empty");
		await writeConfig(
			{ registries: [{ name: "vibes", repo: "github.com/imarios/vibes" }] },
			configPath,
		);
		// No index written — simulates never-updated registry

		await expect(addCommand("python-coding", { configPath, cacheDir }, dir)).rejects.toThrow(
			"update",
		);
	});

	test("uses --registry flag to filter to one registry", async () => {
		const dir = await setup();
		const configPath = join(dir, ".skilltree-config.yaml");
		const cacheDir = join(dir, ".skilltree-cache");

		// Two registries with the same skill
		await writeConfig(
			{
				registries: [
					{ name: "vibes", repo: "github.com/imarios/vibes" },
					{ name: "community", repo: "github.com/skillkit/community" },
				],
			},
			configPath,
		);

		const vibesIndex: RegistryIndex = {
			registry: "vibes",
			repo: "github.com/imarios/vibes",
			updated_at: new Date().toISOString(),
			entities: [{ name: "python-coding", type: "skill", path: "skills/python-coding" }],
		};
		await writeRegistryIndex(vibesIndex, cacheDir);

		const communityIndex: RegistryIndex = {
			registry: "community",
			repo: "github.com/skillkit/community",
			updated_at: new Date().toISOString(),
			entities: [{ name: "python-coding", type: "skill", path: "skills/python-coding" }],
		};
		await writeRegistryIndex(communityIndex, cacheDir);

		// Use --registry to pick vibes
		await addCommand("python-coding", { registry: "vibes", configPath, cacheDir }, dir);

		const manifest = await readManifestRaw(dir);
		const dep = manifest.dependencies?.["python-coding"];
		expect(dep && isRemoteDependency(dep) && dep.repo).toBe("github.com/imarios/vibes");
	});

	test("still works with explicit --repo (registries not consulted)", async () => {
		const dir = await setup();

		await addCommand("my-skill", { repo: "github.com/other/repo", path: "skills/my-skill" }, dir);

		const manifest = await readManifestRaw(dir);
		const dep = manifest.dependencies?.["my-skill"];
		expect(dep && isRemoteDependency(dep) && dep.repo).toBe("github.com/other/repo");
	});

	test("still works with --local (registries not consulted)", async () => {
		const dir = await setup();
		// Create a local skill dir
		await mkdir(join(dir, "skills", "local-skill"), { recursive: true });

		await addCommand("local-skill", { local: "./skills/local-skill" }, dir);

		const manifest = await readManifestRaw(dir);
		const dep = manifest.dependencies?.["local-skill"];
		expect(dep && isLocalDependency(dep) && dep.local).toBe("./skills/local-skill");
	});
});
