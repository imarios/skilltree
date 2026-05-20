import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { addCommand } from "../../src/commands/add.js";
import { initCommand } from "../../src/commands/init.js";
import { writeRegistryIndex } from "../../src/core/registry-cache.js";
import { writeConfig } from "../../src/core/registry-config.js";
import { isPackDependency, type Manifest, type RegistryIndex } from "../../src/types.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(
		tmpdir(),
		`skilltree-addreg-pack-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await mkdir(tempDir, { recursive: true });
	await initCommand(tempDir);
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("registry-resolved pack", () => {
	test("kind=pack entry in registry → add writes a PackDependency", async () => {
		const dir = await setup();
		const configPath = join(dir, ".skilltree-config.yaml");
		const cacheDir = join(dir, ".skilltree-cache");

		await writeConfig(
			{ registries: [{ name: "acme", repo: "github.com/acme/skill-packs" }] },
			configPath,
		);

		const index: RegistryIndex = {
			registry: "acme",
			repo: "github.com/acme/skill-packs",
			updated_at: new Date().toISOString(),
			entities: [
				{
					name: "python-pack",
					type: "skill",
					path: "pack:python-pack",
					kind: "pack",
				},
			],
		};
		await writeRegistryIndex(index, cacheDir);

		await addCommand("python-pack", { configPath, cacheDir }, dir);

		const content = await readFile(join(dir, "skilltree.yml"), "utf-8");
		const m = YAML.parse(content) as Manifest;
		const dep = m.dependencies?.["python-pack"];
		expect(dep).toBeDefined();
		expect(dep && isPackDependency(dep)).toBe(true);
		expect(dep && "repo" in dep ? dep.repo : null).toBe("github.com/acme/skill-packs");
	});
});
