import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanLocalRepo } from "../../src/core/repo-scanner.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-repo-scan-"));
	return tempDir;
}

async function writeSkill(dir: string, skillDir: string, name: string, description?: string) {
	const abs = join(dir, skillDir);
	await mkdir(abs, { recursive: true });
	const fm = description
		? `---\nname: ${name}\ndescription: ${description}\n---\n\nBody\n`
		: `---\nname: ${name}\n---\n\nBody\n`;
	await writeFile(join(abs, "SKILL.md"), fm);
}

async function writeAgent(dir: string, relPath: string, fm: string) {
	const abs = join(dir, relPath);
	await mkdir(join(abs, ".."), { recursive: true });
	await writeFile(abs, `---\n${fm}\n---\n\nBody\n`);
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("scanLocalRepo", () => {
	test("returns empty array for a directory with no skills or agents", async () => {
		const dir = await setup();
		await writeFile(join(dir, "README.md"), "# hello\n");
		const result = await scanLocalRepo(dir);
		expect(result).toEqual([]);
	});

	test("finds a single SKILL.md", async () => {
		const dir = await setup();
		await writeSkill(dir, "skills/my-skill", "my-skill", "A fine skill");

		const result = await scanLocalRepo(dir);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			name: "my-skill",
			type: "skill",
			path: "skills/my-skill",
			description: "A fine skill",
		});
	});

	test("falls back to directory basename when frontmatter has no name", async () => {
		const dir = await setup();
		const abs = join(dir, "skills/unnamed");
		await mkdir(abs, { recursive: true });
		await writeFile(join(abs, "SKILL.md"), "---\ndescription: no name\n---\n");

		const result = await scanLocalRepo(dir);
		expect(result).toHaveLength(1);
		expect(result[0]?.name).toBe("unnamed");
		expect(result[0]?.type).toBe("skill");
	});

	test("finds agent .md with frontmatter name", async () => {
		const dir = await setup();
		await writeAgent(
			dir,
			"agents/code-reviewer.md",
			"name: code-reviewer\ndescription: Reviews code",
		);

		const result = await scanLocalRepo(dir);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			name: "code-reviewer",
			type: "agent",
			path: "agents/code-reviewer.md",
			description: "Reviews code",
		});
	});

	test("skips .md files without frontmatter", async () => {
		const dir = await setup();
		await writeFile(join(dir, "notes.md"), "# just a note\n");

		const result = await scanLocalRepo(dir);
		expect(result).toEqual([]);
	});

	test("skips .md files with frontmatter but no name", async () => {
		const dir = await setup();
		await writeFile(join(dir, "random.md"), "---\ntags: [a, b]\n---\n\nBody\n");

		const result = await scanLocalRepo(dir);
		expect(result).toEqual([]);
	});

	test("skips reserved .md filenames like README.md, CHANGELOG.md", async () => {
		const dir = await setup();
		// Even with frontmatter that looks agent-shaped, reserved names must not
		// be treated as agents.
		await writeFile(join(dir, "README.md"), "---\nname: the-readme\n---\n\n# Readme\n");
		await writeFile(join(dir, "CHANGELOG.md"), "---\nname: changes\n---\n\n# Changelog\n");
		await writeFile(join(dir, "CLAUDE.md"), "---\nname: instructions\n---\n\nConfig\n");

		const result = await scanLocalRepo(dir);
		expect(result).toEqual([]);
	});

	test("excludes hidden dirs (.claude, .git, .github)", async () => {
		const dir = await setup();
		// Installed artifacts under .claude/ must NOT be picked up.
		await writeSkill(dir, ".claude/skills/installed", "installed");
		await writeAgent(dir, ".claude/agents/installed-agent.md", "name: installed-agent");
		await writeAgent(dir, ".github/workflows/ci.md", "name: ci");
		await mkdir(join(dir, ".git"), { recursive: true });
		await writeFile(join(dir, ".git/HEAD"), "ref: refs/heads/main\n");

		// A real, in-repo skill must still be found.
		await writeSkill(dir, "skills/real", "real");

		const result = await scanLocalRepo(dir);
		expect(result).toHaveLength(1);
		expect(result[0]?.name).toBe("real");
	});

	test("excludes node_modules, dist, build, coverage", async () => {
		const dir = await setup();
		await writeSkill(dir, "node_modules/pkg/skills/nope", "nope-nm");
		await writeSkill(dir, "dist/skills/nope", "nope-dist");
		await writeSkill(dir, "build/skills/nope", "nope-build");
		await writeSkill(dir, "coverage/skills/nope", "nope-cov");
		await writeSkill(dir, "skills/keep", "keep");

		const result = await scanLocalRepo(dir);
		expect(result.map((r) => r.name).sort()).toEqual(["keep"]);
	});

	test("finds skills and agents together, sorted by (type, name)", async () => {
		const dir = await setup();
		await writeSkill(dir, "skills/b-skill", "b-skill");
		await writeSkill(dir, "skills/a-skill", "a-skill");
		await writeAgent(dir, "agents/z-agent.md", "name: z-agent");
		await writeAgent(dir, "agents/m-agent.md", "name: m-agent");

		const result = await scanLocalRepo(dir);
		expect(result.map((r) => `${r.type}:${r.name}`)).toEqual([
			"agent:m-agent",
			"agent:z-agent",
			"skill:a-skill",
			"skill:b-skill",
		]);
	});

	// Regression for issue #21: same bug pattern in the local repo scanner.
	// Slash-commands set only `description:` (no `name:`) but the path under
	// `commands/` is sufficient signal to keep them.
	test("finds slash-command with only description in frontmatter", async () => {
		const dir = await setup();
		await writeAgent(
			dir,
			"commands/hypothesis.md",
			"description: Generate 4 hypotheses about the last change",
		);

		const result = await scanLocalRepo(dir);
		expect(result).toHaveLength(1);
		expect(result[0]?.name).toBe("hypothesis");
		expect(result[0]?.type).toBe("command");
		expect(result[0]?.path).toBe("commands/hypothesis.md");
	});

	test("agent .md without name: is still skipped (heuristic preserved)", async () => {
		const dir = await setup();
		await writeAgent(dir, "agents/no-name.md", "description: agent without a name");

		const result = await scanLocalRepo(dir);
		expect(result).toEqual([]);
	});

	// Parity with registry-scanner: an agent with `skills:` but no `name:` is
	// still indexable (composite-agent heuristic). Without this, the same
	// input would classify differently in the two scan paths.
	test("agent with skills: but no name: is kept (matches registry-scanner heuristic)", async () => {
		const dir = await setup();
		await writeAgent(
			dir,
			"agents/composite.md",
			"skills: [python-coding, general-coding]\ndescription: composite agent",
		);

		const result = await scanLocalRepo(dir);
		expect(result).toHaveLength(1);
		expect(result[0]?.name).toBe("composite");
		expect(result[0]?.type).toBe("agent");
	});

	test("tolerates malformed frontmatter without crashing (skips file)", async () => {
		const dir = await setup();
		await mkdir(join(dir, "agents"), { recursive: true });
		// Unclosed frontmatter — parseFrontmatter throws. Scanner must not propagate.
		await writeFile(join(dir, "agents/bad.md"), "---\nname: bad\n");
		// A good sibling must still be reported.
		await writeAgent(dir, "agents/good.md", "name: good");

		const result = await scanLocalRepo(dir);
		expect(result.map((r) => r.name)).toEqual(["good"]);
	});
});
