import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { addCommand } from "../../src/commands/add.js";
import { initCommand } from "../../src/commands/init.js";
import { isPackDependency, type Manifest } from "../../src/types.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(
		tmpdir(),
		`skilltree-addpack-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

async function readManifestRaw(dir: string): Promise<Manifest> {
	const content = await readFile(join(dir, "skilltree.yml"), "utf-8");
	return YAML.parse(content) as Manifest;
}

async function writeManifestRaw(dir: string, manifest: Manifest): Promise<void> {
	await writeFile(join(dir, "skilltree.yml"), YAML.stringify(manifest));
}

describe("add --pack", () => {
	test("--pack --repo writes remote pack ref with version", async () => {
		const dir = await setup();
		await addCommand(
			"python-pack",
			{
				pack: true,
				repo: "github.com/acme/skill-packs",
				version: "^1.0.0",
			},
			dir,
		);
		const m = await readManifestRaw(dir);
		const dep = m.dependencies?.["python-pack"];
		expect(dep).toBeDefined();
		expect(dep && isPackDependency(dep)).toBe(true);
		expect(dep).toEqual({
			pack: "python-pack",
			repo: "github.com/acme/skill-packs",
			version: "^1.0.0",
		});
	});

	test("--pack with rename: yaml key uses name arg, pack: field uses --pack arg", async () => {
		const dir = await setup();
		await addCommand(
			"my-stack",
			{
				pack: "python-pack",
				repo: "github.com/acme/skill-packs",
				version: "^1.0.0",
			},
			dir,
		);
		const m = await readManifestRaw(dir);
		const dep = m.dependencies?.["my-stack"];
		expect(dep).toEqual({
			pack: "python-pack",
			repo: "github.com/acme/skill-packs",
			version: "^1.0.0",
		});
	});

	test("--pack --dev writes to dev-dependencies", async () => {
		const dir = await setup();
		await addCommand(
			"python-pack",
			{ pack: true, repo: "github.com/acme/skill-packs", dev: true },
			dir,
		);
		const m = await readManifestRaw(dir);
		expect(m["dev-dependencies"]?.["python-pack"]).toBeDefined();
		expect(m.dependencies?.["python-pack"]).toBeUndefined();
	});

	test("--pack with no source flags writes a local pack ref", async () => {
		const dir = await setup();
		await addCommand("python-pack", { pack: true }, dir);
		const m = await readManifestRaw(dir);
		expect(m.dependencies?.["python-pack"]).toEqual({ pack: "python-pack" });
	});

	test("--pack + --path is rejected", async () => {
		const dir = await setup();
		await expect(
			addCommand("python-pack", { pack: true, repo: "github.com/a/b", path: "x" }, dir),
		).rejects.toThrow(/--pack.*path/);
	});

	test("--pack + --local is rejected", async () => {
		const dir = await setup();
		await expect(addCommand("python-pack", { pack: true, local: "./x" }, dir)).rejects.toThrow(
			/--pack.*local/,
		);
	});

	test("--pack + --type is rejected", async () => {
		const dir = await setup();
		await expect(
			addCommand("python-pack", { pack: true, repo: "github.com/a/b", type: "agent" }, dir),
		).rejects.toThrow(/--pack.*type/);
	});
});

describe("add — local pack short-circuit", () => {
	test("name matches packs.<name> + no flags → writes local pack ref", async () => {
		const dir = await setup();
		await writeManifestRaw(dir, {
			packs: {
				"my-stack": [{ repo: "github.com/acme/skills", path: "foo" }],
			},
		});

		await addCommand("my-stack", {}, dir);
		const m = await readManifestRaw(dir);
		expect(m.dependencies?.["my-stack"]).toEqual({ pack: "my-stack" });
	});

	test("name does NOT match packs.<name> → falls through to registry resolution (rejects)", async () => {
		const dir = await setup();
		await writeManifestRaw(dir, {
			packs: { "other-pack": [{ repo: "github.com/acme/skills", path: "foo" }] },
		});

		// Without --pack and without a matching packs.<name>, this tries to
		// resolve via registries — which we don't set up here — so it errors.
		// The short-circuit should NOT fire.
		await expect(addCommand("not-a-pack", {}, dir)).rejects.toThrow();
	});
});

describe("add — pack ref overwrite messaging", () => {
	test("overwriting a pack ref with a different pack ref prints pack-specific message", async () => {
		const dir = await setup();
		// First add
		await addCommand(
			"python-pack",
			{ pack: true, repo: "github.com/acme/skill-packs", version: "^1.0.0" },
			dir,
		);
		// Overwrite with new repo — should not throw, should warn with pack-ref wording
		await addCommand(
			"python-pack",
			{ pack: true, repo: "github.com/other/skill-packs", version: "^1.0.0" },
			dir,
		);
		const m = await readManifestRaw(dir);
		const dep = m.dependencies?.["python-pack"];
		expect(dep && isPackDependency(dep)).toBe(true);
		expect(dep && "repo" in dep ? dep.repo : null).toBe("github.com/other/skill-packs");
	});
});
