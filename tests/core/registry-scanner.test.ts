import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import {
	dynamicScanRepo,
	parseSkillkitIndex,
	scanRegistry,
} from "../../src/core/registry-scanner.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(
		tmpdir(),
		`skilltree-regscan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await mkdir(tempDir, { recursive: true });
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

/**
 * Create a source repo with skills/agents and return a bare clone.
 */
async function createBareFixture(baseDir: string, files: Record<string, string>): Promise<string> {
	const sourceDir = join(baseDir, "source");
	await mkdir(sourceDir, { recursive: true });
	const git = simpleGit(sourceDir);
	await git.init();
	await git.addConfig("user.email", "test@test.com");
	await git.addConfig("user.name", "Test");

	for (const [path, content] of Object.entries(files)) {
		const fullPath = join(sourceDir, path);
		await mkdir(join(fullPath, ".."), { recursive: true });
		await writeFile(fullPath, content, "utf-8");
	}

	await git.add(".");
	await git.commit("initial");

	// Clone as bare repo
	const bareDir = join(baseDir, "bare");
	await simpleGit().clone(sourceDir, bareDir, ["--bare"]);
	return bareDir;
}

describe("parseSkillkitIndex", () => {
	test("parses valid index with skills and agents", () => {
		const yaml = `
entities:
  - name: python-coding
    type: skill
    path: skills/python-coding
    description: "Python development"
    tags: [python, testing]
  - name: cybersec-analyst
    type: agent
    path: agents/cybersec-analyst.md
    description: "Security investigation"
`;
		const entries = parseSkillkitIndex(yaml);
		expect(entries).toHaveLength(2);
		expect(entries[0]?.name).toBe("python-coding");
		expect(entries[0]?.type).toBe("skill");
		expect(entries[0]?.tags).toEqual(["python", "testing"]);
		expect(entries[1]?.name).toBe("cybersec-analyst");
		expect(entries[1]?.type).toBe("agent");
	});

	test("handles entries without optional fields", () => {
		const yaml = `
entities:
  - name: minimal
    type: skill
    path: skills/minimal
`;
		const entries = parseSkillkitIndex(yaml);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.description).toBeUndefined();
		expect(entries[0]?.tags).toBeUndefined();
	});

	test("returns empty array for empty entities list", () => {
		const yaml = "entities: []\n";
		const entries = parseSkillkitIndex(yaml);
		expect(entries).toHaveLength(0);
	});
});

describe("dynamicScanRepo", () => {
	test("finds skills (directories with SKILL.md)", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skills/python-coding/SKILL.md":
				"---\nname: python-coding\ndescription: Python dev\n---\n\n# Content\n",
		});

		const entries = await dynamicScanRepo(bareDir);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.name).toBe("python-coding");
		expect(entries[0]?.type).toBe("skill");
		expect(entries[0]?.path).toBe("skills/python-coding");
		expect(entries[0]?.description).toBe("Python dev");
	});

	test("finds agents (standalone .md files with agent frontmatter)", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"agents/cybersec.md": "---\nname: cybersec\nskills: python-coding\n---\n\n# Agent\n",
		});

		const entries = await dynamicScanRepo(bareDir);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.name).toBe("cybersec");
		expect(entries[0]?.type).toBe("agent");
		expect(entries[0]?.path).toBe("agents/cybersec.md");
	});

	test("skips non-skill .md files (README.md, CHANGELOG.md)", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"README.md": "# My Repo\n\nJust a readme.",
			"CHANGELOG.md": "# Changes\n\n- v1.0.0",
			"docs/NOTES.md": "Some notes.",
			"skills/python-coding/SKILL.md": "---\nname: python-coding\n---\n\n# Content\n",
		});

		const entries = await dynamicScanRepo(bareDir);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.name).toBe("python-coding");
	});

	test("extracts name from frontmatter when present", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skills/my-skill/SKILL.md":
				"---\nname: custom-name\ndescription: Has custom name\n---\n\n# Content\n",
		});

		const entries = await dynamicScanRepo(bareDir);
		expect(entries[0]?.name).toBe("custom-name");
	});

	test("falls back to directory name when frontmatter has no name", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skills/dir-name/SKILL.md": "---\ndescription: No name field\n---\n\n# Content\n",
		});

		const entries = await dynamicScanRepo(bareDir);
		expect(entries[0]?.name).toBe("dir-name");
	});

	test("extracts description from frontmatter", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skills/test/SKILL.md":
				"---\nname: test\ndescription: Test skill description\n---\n\n# Content\n",
		});

		const entries = await dynamicScanRepo(bareDir);
		expect(entries[0]?.description).toBe("Test skill description");
	});

	test("returns empty array for repo with no skills", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"README.md": "# Empty repo\n",
			"src/main.ts": "console.log('hello');\n",
		});

		const entries = await dynamicScanRepo(bareDir);
		expect(entries).toHaveLength(0);
	});
});

describe("scanRegistry", () => {
	test("uses skillkit-index.yaml when present", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skillkit-index.yaml": `entities:
  - name: indexed-skill
    type: skill
    path: skills/indexed-skill
    description: "From index file"
    tags: [indexed]
`,
			"skills/indexed-skill/SKILL.md": "---\nname: indexed-skill\n---\n\n# Content\n",
		});

		const entries = await scanRegistry(bareDir);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.name).toBe("indexed-skill");
		// Should have tags from index file (dynamic scan wouldn't have tags)
		expect(entries[0]?.tags).toEqual(["indexed"]);
	});

	test("falls back to dynamic scan when no index file", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skills/python-coding/SKILL.md":
				"---\nname: python-coding\ndescription: Python dev\n---\n\n# Content\n",
		});

		const entries = await scanRegistry(bareDir);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.name).toBe("python-coding");
	});
});
