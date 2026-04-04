import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyToFrontmatter, scanFile } from "../../src/core/scanner.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-scan-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function writeSkill(
	dir: string,
	name: string,
	body: string,
	deps?: string[],
): Promise<string> {
	const skillDir = join(dir, name);
	await mkdir(skillDir, { recursive: true });
	const depsYaml = deps?.length ? `dependencies:\n${deps.map((d) => `  - ${d}`).join("\n")}` : "";
	const content = `---\nname: ${name}\n${depsYaml}\n---\n\n${body}\n`;
	const filePath = join(skillDir, "SKILL.md");
	await writeFile(filePath, content);
	return filePath;
}

describe("scanFile", () => {
	test("detects LOAD directive pattern", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(dir, "my-skill", "**LOAD** `task-builder` skill to help.");

		const result = await scanFile(filePath);
		expect(result?.detected).toContain("task-builder");
		expect(result?.undeclared).toContain("task-builder");
	});

	test("detects 'Use the X skill' pattern", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(
			dir,
			"my-skill",
			"Use the python-coding skill for best results.",
		);

		const result = await scanFile(filePath);
		expect(result?.detected).toContain("python-coding");
	});

	test("detects 'Use `X` skill' pattern", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(dir, "my-skill", "Use `cy-language` skill when writing Cy.");

		const result = await scanFile(filePath);
		expect(result?.detected).toContain("cy-language");
	});

	test("detects 'Load the X skill' pattern", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(dir, "my-skill", "Load the splunk-skill skill for queries.");

		const result = await scanFile(filePath);
		expect(result?.detected).toContain("splunk-skill");
	});

	test("does not report declared deps as undeclared", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(
			dir,
			"my-skill",
			"Use the python-coding skill for best results.",
			["python-coding"],
		);

		const result = await scanFile(filePath);
		expect(result?.detected).toContain("python-coding");
		expect(result?.undeclared).toEqual([]);
	});

	test("filters self-references", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(dir, "my-skill", "Use the my-skill skill for recursion.");

		const result = await scanFile(filePath);
		expect(result?.detected).not.toContain("my-skill");
	});

	test("returns null for files without frontmatter", async () => {
		const dir = await makeTempDir();
		const filePath = join(dir, "plain.md");
		await writeFile(filePath, "# Just a markdown file\n\nNo frontmatter.\n");

		const result = await scanFile(filePath);
		expect(result).toBeNull();
	});

	test("detects multiple references", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(
			dir,
			"my-skill",
			"Use the python-coding skill and load task-builder skill for best results.",
		);

		const result = await scanFile(filePath);
		expect(result?.detected).toContain("python-coding");
		expect(result?.detected).toContain("task-builder");
	});

	test("detects 'Refer to the X skill' pattern", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(
			dir,
			"my-skill",
			"Refer to the ocsf-detection-finding skill for OCSF mappings.",
		);

		const result = await scanFile(filePath);
		expect(result?.detected).toContain("ocsf-detection-finding");
	});

	test("detects 'Follow the X skill' pattern", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(
			dir,
			"my-skill",
			"Follow the ocsf-detection-finding skill when building detections.",
		);

		const result = await scanFile(filePath);
		expect(result?.detected).toContain("ocsf-detection-finding");
	});

	test("detects 'the X skill' with various verbs", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(
			dir,
			"my-skill",
			"Check the splunk-skill skill. Apply the general-coding skill here.",
		);

		const result = await scanFile(filePath);
		expect(result?.detected).toContain("splunk-skill");
		expect(result?.detected).toContain("general-coding");
	});

	test("detects skill name in backticks: the `X` skill", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(
			dir,
			"my-skill",
			"Refer to the `ocsf-detection-finding` skill for mappings.",
		);

		const result = await scanFile(filePath);
		expect(result?.detected).toContain("ocsf-detection-finding");
	});

	test("detects skill name in single quotes: the 'X' skill", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(
			dir,
			"my-skill",
			"Follow the 'ocsf-detection-finding' skill when building detections.",
		);

		const result = await scanFile(filePath);
		expect(result?.detected).toContain("ocsf-detection-finding");
	});

	test('detects skill name in double quotes: the "X" skill', async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(
			dir,
			"my-skill",
			'Check the "splunk-skill" skill for queries.',
		);

		const result = await scanFile(filePath);
		expect(result?.detected).toContain("splunk-skill");
	});

	test("detects skill name in angle brackets: the <X> skill", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(
			dir,
			"my-skill",
			"Load the <task-builder> skill before proceeding.",
		);

		const result = await scanFile(filePath);
		expect(result?.detected).toContain("task-builder");
	});

	test("detects standalone quoted skill name: `X` skill (no article)", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(
			dir,
			"my-skill",
			"The `general-coding` skill covers TDD workflows.",
		);

		const result = await scanFile(filePath);
		expect(result?.detected).toContain("general-coding");
	});

	test("does not match 'skills' (plural) as a reference", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(
			dir,
			"my-skill",
			"use the dedicated skills:\n- python-coding\n- testing",
		);

		const result = await scanFile(filePath);
		expect(result?.detected).not.toContain("dedicated");
	});

	test("filters short names (< 2 chars)", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(dir, "my-skill", "Use the x skill and use the ab skill.");

		const result = await scanFile(filePath);
		// "x" should be filtered (< 2 chars), "ab" should pass
		expect(result?.detected).not.toContain("x");
		expect(result?.detected).toContain("ab");
	});
});

describe("applyToFrontmatter", () => {
	test("adds undeclared deps to frontmatter", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(dir, "my-skill", "Use the python-coding skill.", [
			"existing-dep",
		]);

		await applyToFrontmatter(filePath, ["python-coding"]);

		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("- existing-dep");
		expect(content).toContain("- python-coding");
	});

	test("does not duplicate existing deps", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(dir, "my-skill", "body", ["python-coding"]);

		await applyToFrontmatter(filePath, ["python-coding"]);

		const content = await readFile(filePath, "utf-8");
		const matches = content.match(/python-coding/g);
		// Should appear exactly twice: once in deps, once we just don't duplicate
		expect(matches?.length).toBe(1); // Only in the deps list
	});

	test("handles file with no existing deps field", async () => {
		const dir = await makeTempDir();
		const skillDir = join(dir, "no-deps");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			"---\nname: no-deps\ndescription: A skill\n---\n\nUse the python-coding skill.\n",
		);

		await applyToFrontmatter(join(skillDir, "SKILL.md"), ["python-coding"]);

		const content = await readFile(join(skillDir, "SKILL.md"), "utf-8");
		expect(content).toContain("- python-coding");
	});

	test("handles empty dependencies list in frontmatter", async () => {
		const dir = await makeTempDir();
		const filePath = await writeSkill(dir, "empty-deps", "Use the task-builder skill.", []);

		await applyToFrontmatter(filePath, ["task-builder"]);

		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("- task-builder");
	});
});
