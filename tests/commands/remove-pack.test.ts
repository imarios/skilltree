import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { removeCommand } from "../../src/commands/remove.js";
import type { Manifest } from "../../src/types.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(
		tmpdir(),
		`skilltree-removepack-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await mkdir(tempDir, { recursive: true });
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function writeManifest(dir: string, manifest: Manifest): Promise<void> {
	await writeFile(join(dir, "skilltree.yml"), YAML.stringify(manifest));
}

async function readManifest(dir: string): Promise<Manifest> {
	return YAML.parse(await readFile(join(dir, "skilltree.yml"), "utf-8")) as Manifest;
}

describe("remove pack ref", () => {
	test("removes a local pack ref from manifest without errors", async () => {
		const dir = await setup();
		await writeManifest(dir, {
			packs: {
				"my-stack": [{ repo: "github.com/acme/skills", path: "foo" }],
			},
			dependencies: {
				"my-stack": { pack: "my-stack" },
			},
		});

		await removeCommand("my-stack", dir, { force: true });

		const m = await readManifest(dir);
		expect(m.dependencies?.["my-stack"]).toBeUndefined();
		// The `packs:` definition is preserved — it's a separate declaration,
		// not the same thing as the consumer-side reference.
		expect(m.packs?.["my-stack"]).toBeDefined();
	});

	test("removes a remote pack ref from manifest without errors", async () => {
		const dir = await setup();
		await writeManifest(dir, {
			dependencies: {
				"python-pack": {
					pack: "python-pack",
					repo: "github.com/acme/skill-packs",
					version: "^1.0.0",
				},
			},
		});

		await removeCommand("python-pack", dir, { force: true });

		const m = await readManifest(dir);
		expect(m.dependencies?.["python-pack"]).toBeUndefined();
	});
});
