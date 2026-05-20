import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifestScanRepo, parseIndex } from "../../src/core/registry-scanner.js";
import { createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("registry scanner — packs", () => {
	test("emits one kind='pack' entry per packs: entry in repo manifest", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-scanner-packs-"));
		const manifestYaml = [
			"name: acme",
			"packs:",
			"  python-pack:",
			"    - repo: github.com/acme/python-skills",
			"      path: python-coding",
			"  js-pack:",
			"    - repo: github.com/acme/js-skills",
			"      path: react-coding",
		].join("\n");
		const repo = await createTestRepo(tempDir, "acme-packs", [], "v1.0.0", manifestYaml);

		const entries = await manifestScanRepo(repo);
		expect(entries).not.toBeNull();
		const packs = entries!.filter((e) => e.kind === "pack");
		expect(packs).toHaveLength(2);
		expect(packs.map((p) => p.name).sort()).toEqual(["js-pack", "python-pack"]);
		for (const p of packs) {
			expect(p.path).toBe(`pack:${p.name}`);
		}
	});

	test("manifest with both local deps and packs: yields entity + pack entries", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-scanner-mix-"));
		const manifestYaml = [
			"name: acme",
			"dependencies:",
			"  my-skill:",
			"    local: ./my-skill",
			"packs:",
			"  my-stack:",
			"    - repo: github.com/x/y",
			"      path: a",
		].join("\n");
		const repo = await createTestRepo(
			tempDir,
			"acme-mix",
			[{ path: "my-skill", name: "my-skill" }],
			"v1.0.0",
			manifestYaml,
		);

		const entries = await manifestScanRepo(repo);
		expect(entries).not.toBeNull();
		const entityEntries = entries!.filter((e) => e.kind !== "pack");
		const packEntries = entries!.filter((e) => e.kind === "pack");
		expect(entityEntries.some((e) => e.name === "my-skill")).toBe(true);
		expect(packEntries.some((e) => e.name === "my-stack")).toBe(true);
	});
});

describe("parseIndex — kind field", () => {
	test("preserves kind='pack' when present in YAML", () => {
		const yaml = `
entities:
  - name: foo
    type: skill
    path: skills/foo
  - name: my-pack
    type: skill
    path: pack:my-pack
    kind: pack
`;
		const entries = parseIndex(yaml);
		const foo = entries.find((e) => e.name === "foo");
		const pack = entries.find((e) => e.name === "my-pack");
		expect(foo?.kind).toBeUndefined();
		expect(pack?.kind).toBe("pack");
	});
});
