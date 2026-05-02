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

describe("glob-pattern add (Issue #14)", () => {
	async function setupWithKibanaIndex(
		dir: string,
	): Promise<{ configPath: string; cacheDir: string }> {
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
				{ name: "kibana-investigate", type: "skill", path: "skills/kibana-investigate" },
				{ name: "kibana-search", type: "skill", path: "skills/kibana-search" },
				{ name: "kibana-dashboard", type: "skill", path: "skills/kibana-dashboard" },
				{ name: "splunk-skill", type: "skill", path: "skills/splunk-skill" },
				{ name: "python-coding", type: "skill", path: "skills/python-coding" },
			],
		};
		await writeRegistryIndex(index, cacheDir);

		return { configPath, cacheDir };
	}

	test("expands `kibana-*` to all matching registry entries", async () => {
		const dir = await setup();
		const { configPath, cacheDir } = await setupWithKibanaIndex(dir);

		await addCommand("kibana-*", { configPath, cacheDir }, dir);

		const manifest = await readManifestRaw(dir);
		expect(manifest.dependencies?.["kibana-investigate"]).toBeDefined();
		expect(manifest.dependencies?.["kibana-search"]).toBeDefined();
		expect(manifest.dependencies?.["kibana-dashboard"]).toBeDefined();
		// Non-matching entries must not be added.
		expect(manifest.dependencies?.["splunk-skill"]).toBeUndefined();
		expect(manifest.dependencies?.["python-coding"]).toBeUndefined();
	});

	test("glob respects --version and --dev across all matches", async () => {
		const dir = await setup();
		const { configPath, cacheDir } = await setupWithKibanaIndex(dir);

		await addCommand("kibana-*", { configPath, cacheDir, version: "^1.2.0", dev: true }, dir);

		const manifest = await readManifestRaw(dir);
		expect(manifest.dependencies?.["kibana-investigate"]).toBeUndefined();
		const devDep = manifest["dev-dependencies"]?.["kibana-investigate"];
		expect(devDep).toBeDefined();
		expect(devDep && isRemoteDependency(devDep) && devDep.version).toBe("^1.2.0");
	});

	test("glob errors when no registry entries match", async () => {
		const dir = await setup();
		const { configPath, cacheDir } = await setupWithKibanaIndex(dir);

		await expect(addCommand("nomatch-*", { configPath, cacheDir }, dir)).rejects.toThrow(
			"no entries matched",
		);
	});

	test("glob errors when combined with --repo (single-source flag)", async () => {
		const dir = await setup();

		await expect(
			addCommand("kibana-*", { repo: "github.com/x/y", path: "skills/kibana" }, dir),
		).rejects.toThrow(/glob/i);
	});

	test("glob errors when combined with --local (single-source flag)", async () => {
		const dir = await setup();

		await expect(addCommand("kibana-*", { local: "./skills/kibana" }, dir)).rejects.toThrow(
			/glob/i,
		);
	});

	test("glob honors --registry filter", async () => {
		const dir = await setup();
		const configPath = join(dir, ".skilltree-config.yaml");
		const cacheDir = join(dir, ".skilltree-cache");

		await writeConfig(
			{
				registries: [
					{ name: "vibes", repo: "github.com/imarios/vibes" },
					{ name: "other", repo: "github.com/other/other" },
				],
			},
			configPath,
		);

		await writeRegistryIndex(
			{
				registry: "vibes",
				repo: "github.com/imarios/vibes",
				updated_at: new Date().toISOString(),
				entities: [{ name: "kibana-search", type: "skill", path: "skills/kibana-search" }],
			},
			cacheDir,
		);
		await writeRegistryIndex(
			{
				registry: "other",
				repo: "github.com/other/other",
				updated_at: new Date().toISOString(),
				entities: [{ name: "kibana-other", type: "skill", path: "skills/kibana-other" }],
			},
			cacheDir,
		);

		await addCommand("kibana-*", { configPath, cacheDir, registry: "vibes" }, dir);

		const manifest = await readManifestRaw(dir);
		expect(manifest.dependencies?.["kibana-search"]).toBeDefined();
		expect(manifest.dependencies?.["kibana-other"]).toBeUndefined();
	});

	test("name without glob chars is unchanged (no glob path)", async () => {
		const dir = await setup();
		const { configPath, cacheDir } = await setupWithKibanaIndex(dir);

		await addCommand("kibana-search", { configPath, cacheDir }, dir);

		const manifest = await readManifestRaw(dir);
		expect(manifest.dependencies?.["kibana-search"]).toBeDefined();
	});

	test("--global glob writes to the global manifest", async () => {
		const dir = await setup();
		const { configPath, cacheDir } = await setupWithKibanaIndex(dir);
		const globalDir = join(dir, "global-config");
		const { writeGlobalManifest, readGlobalManifest } = await import("../../src/core/manifest.js");
		await writeGlobalManifest({ dependencies: {} }, globalDir);

		await addCommand("kibana-*", { configPath, cacheDir, globalDir, global: true, yes: true }, dir);

		const globalManifest = await readGlobalManifest(globalDir);
		expect(globalManifest.dependencies?.["kibana-search"]).toBeDefined();
		expect(globalManifest.dependencies?.["kibana-investigate"]).toBeDefined();
		// Local manifest should be untouched.
		const local = await readManifestRaw(dir);
		expect(local.dependencies?.["kibana-search"]).toBeUndefined();
	});

	test("--yes skips the prompt even when interactive", async () => {
		const dir = await setup();
		const { configPath, cacheDir } = await setupWithKibanaIndex(dir);
		let asked = false;
		await addCommand(
			"kibana-*",
			{
				configPath,
				cacheDir,
				yes: true,
				isInteractive: true,
				askFn: async () => {
					asked = true;
					return "n";
				},
			},
			dir,
		);
		expect(asked).toBe(false);
		const manifest = await readManifestRaw(dir);
		expect(manifest.dependencies?.["kibana-search"]).toBeDefined();
	});

	test("interactive prompt: 'y' adds entries", async () => {
		const dir = await setup();
		const { configPath, cacheDir } = await setupWithKibanaIndex(dir);
		await addCommand(
			"kibana-*",
			{ configPath, cacheDir, isInteractive: true, askFn: async () => "y" },
			dir,
		);
		const manifest = await readManifestRaw(dir);
		expect(manifest.dependencies?.["kibana-search"]).toBeDefined();
		expect(manifest.dependencies?.["kibana-investigate"]).toBeDefined();
	});

	test("interactive prompt: empty answer (default) adds entries", async () => {
		const dir = await setup();
		const { configPath, cacheDir } = await setupWithKibanaIndex(dir);
		await addCommand(
			"kibana-*",
			{ configPath, cacheDir, isInteractive: true, askFn: async () => "" },
			dir,
		);
		const manifest = await readManifestRaw(dir);
		expect(manifest.dependencies?.["kibana-search"]).toBeDefined();
	});

	test("interactive prompt: 'n' aborts and writes nothing", async () => {
		const dir = await setup();
		const { configPath, cacheDir } = await setupWithKibanaIndex(dir);
		await addCommand(
			"kibana-*",
			{ configPath, cacheDir, isInteractive: true, askFn: async () => "n" },
			dir,
		);
		const manifest = await readManifestRaw(dir);
		expect(manifest.dependencies?.["kibana-search"]).toBeUndefined();
		expect(manifest.dependencies?.["kibana-investigate"]).toBeUndefined();
	});

	test("non-interactive default proceeds without --yes (CI-safe)", async () => {
		// No `isInteractive`, no `askFn`, no `--yes`. Mirrors how the test
		// runner invokes the CLI: stdout is piped, so detection falls
		// through to the CI-safe default of proceeding.
		const dir = await setup();
		const { configPath, cacheDir } = await setupWithKibanaIndex(dir);
		await addCommand("kibana-*", { configPath, cacheDir }, dir);
		const manifest = await readManifestRaw(dir);
		expect(manifest.dependencies?.["kibana-search"]).toBeDefined();
	});

	test("cross-registry collision: picks first, surfaces alternate in preview", async () => {
		const dir = await setup();
		const configPath = join(dir, ".skilltree-config.yaml");
		const cacheDir = join(dir, ".skilltree-cache");

		await writeConfig(
			{
				registries: [
					{ name: "vibes", repo: "github.com/imarios/vibes" },
					{ name: "open-vibes", repo: "github.com/imarios/open-vibes" },
				],
			},
			configPath,
		);
		await writeRegistryIndex(
			{
				registry: "vibes",
				repo: "github.com/imarios/vibes",
				updated_at: new Date().toISOString(),
				entities: [{ name: "kubernetes", type: "skill", path: "skills/kubernetes" }],
			},
			cacheDir,
		);
		await writeRegistryIndex(
			{
				registry: "open-vibes",
				repo: "github.com/imarios/open-vibes",
				updated_at: new Date().toISOString(),
				entities: [{ name: "kubernetes", type: "skill", path: "skills/kubernetes" }],
			},
			cacheDir,
		);

		// Capture warn() output
		const warnings: string[] = [];
		const origWarn = console.warn;
		console.warn = (msg: string) => warnings.push(msg);
		try {
			await addCommand("kuber*", { configPath, cacheDir, yes: true }, dir);
		} finally {
			console.warn = origWarn;
		}

		const manifest = await readManifestRaw(dir);
		const dep = manifest.dependencies?.kubernetes;
		expect(dep && isRemoteDependency(dep) && dep.repo).toBe("github.com/imarios/vibes");
		expect(warnings.some((w) => w.includes("kubernetes") && w.includes("open-vibes"))).toBe(true);
	});

	test("supports `?` as single-char glob", async () => {
		const dir = await setup();
		const configPath = join(dir, ".skilltree-config.yaml");
		const cacheDir = join(dir, ".skilltree-cache");

		await writeConfig(
			{ registries: [{ name: "vibes", repo: "github.com/imarios/vibes" }] },
			configPath,
		);
		await writeRegistryIndex(
			{
				registry: "vibes",
				repo: "github.com/imarios/vibes",
				updated_at: new Date().toISOString(),
				entities: [
					{ name: "ab", type: "skill", path: "skills/ab" },
					{ name: "ac", type: "skill", path: "skills/ac" },
					{ name: "abc", type: "skill", path: "skills/abc" },
				],
			},
			cacheDir,
		);

		await addCommand("a?", { configPath, cacheDir }, dir);

		const manifest = await readManifestRaw(dir);
		expect(manifest.dependencies?.ab).toBeDefined();
		expect(manifest.dependencies?.ac).toBeDefined();
		expect(manifest.dependencies?.abc).toBeUndefined();
	});
});
