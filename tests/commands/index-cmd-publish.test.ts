import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { indexCommand } from "../../src/commands/index-cmd.js";
import { _resetDeprecationWarningsForTests } from "../../src/core/filenames.js";

let tempDir: string;

beforeEach(() => {
	_resetDeprecationWarningsForTests();
});

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-index-publish-"));
	return tempDir;
}

async function writeSkill(dir: string, name: string, description: string): Promise<void> {
	const skillDir = join(dir, "skills", name);
	await mkdir(skillDir, { recursive: true });
	await writeFile(
		join(skillDir, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
		"utf-8",
	);
}

describe("registry index — publication-surface filtering (Carbon Phase 2)", () => {
	test("skips publish: false local entries", async () => {
		const dir = await makeTempDir();
		await writeSkill(dir, "foo", "Public skill");
		await writeSkill(dir, "wip", "WIP skill");

		await writeFile(
			join(dir, "skilltree.yml"),
			`dependencies:
  foo:
    local: ./skills/foo
    type: skill
  wip:
    local: ./skills/wip
    type: skill
    publish: false
`,
			"utf-8",
		);

		await indexCommand({}, dir);
		const indexContent = await readFile(join(dir, "skilltree-index.yml"), "utf-8");
		const parsed = YAML.parse(indexContent) as { entities: Array<{ name: string }> };
		expect(parsed.entities.map((e) => e.name).sort()).toEqual(["foo"]);
	});

	test("skips dev-dependencies local entries", async () => {
		const dir = await makeTempDir();
		await writeSkill(dir, "foo", "Public skill");
		await writeSkill(dir, "internal", "Internal tool");

		await writeFile(
			join(dir, "skilltree.yml"),
			`dependencies:
  foo:
    local: ./skills/foo
    type: skill
dev-dependencies:
  internal:
    local: ./skills/internal
    type: skill
`,
			"utf-8",
		);

		await indexCommand({}, dir);
		const indexContent = await readFile(join(dir, "skilltree-index.yml"), "utf-8");
		const parsed = YAML.parse(indexContent) as { entities: Array<{ name: string }> };
		expect(parsed.entities.map((e) => e.name).sort()).toEqual(["foo"]);
	});

	test("no manifest → no filtering, all skills indexed (today's behavior)", async () => {
		const dir = await makeTempDir();
		await writeSkill(dir, "foo", "Skill foo");
		await writeSkill(dir, "bar", "Skill bar");

		await indexCommand({}, dir);
		const indexContent = await readFile(join(dir, "skilltree-index.yml"), "utf-8");
		const parsed = YAML.parse(indexContent) as { entities: Array<{ name: string }> };
		expect(parsed.entities.map((e) => e.name).sort()).toEqual(["bar", "foo"]);
	});

	test("skill not declared in manifest is still indexed (manifest is hiding-only)", async () => {
		const dir = await makeTempDir();
		await writeSkill(dir, "foo", "Declared");
		await writeSkill(dir, "extra", "Not declared in manifest");

		await writeFile(
			join(dir, "skilltree.yml"),
			`dependencies:
  foo:
    local: ./skills/foo
    type: skill
`,
			"utf-8",
		);

		await indexCommand({}, dir);
		const indexContent = await readFile(join(dir, "skilltree-index.yml"), "utf-8");
		const parsed = YAML.parse(indexContent) as { entities: Array<{ name: string }> };
		expect(parsed.entities.map((e) => e.name).sort()).toEqual(["extra", "foo"]);
	});
});
