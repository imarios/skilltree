import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { inferTypeFromGit } from "../../src/core/graph.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-type-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

/**
 * Create a git repo with a specific structure and return the bare clone path + tag.
 */
async function createRepoWithStructure(
	baseDir: string,
	setup: (repoDir: string) => Promise<void>,
): Promise<{ barePath: string; tag: string }> {
	const repoDir = join(baseDir, "repo");
	await mkdir(repoDir, { recursive: true });
	const git = simpleGit(repoDir);
	await git.init();
	await git.addConfig("user.email", "test@test.com");
	await git.addConfig("user.name", "Test");

	await setup(repoDir);

	await git.add(".");
	await git.commit("Initial commit");
	await git.addTag("v1.0.0");

	const barePath = join(baseDir, "bare");
	await simpleGit().clone(repoDir, barePath, ["--bare"]);

	return { barePath, tag: "v1.0.0" };
}

describe("inferTypeFromGit", () => {
	test("directory with SKILL.md → skill", async () => {
		const dir = await makeTempDir();
		const { barePath, tag } = await createRepoWithStructure(dir, async (repoDir) => {
			await mkdir(join(repoDir, "skills", "my-skill"), { recursive: true });
			await writeFile(
				join(repoDir, "skills", "my-skill", "SKILL.md"),
				"---\nname: my-skill\n---\n",
			);
		});

		const result = await inferTypeFromGit(barePath, tag, "skills/my-skill");
		expect(result.type).toBe("skill");
		expect(result.resolvedPath).toBe("skills/my-skill");
	});

	test("single .md file → agent", async () => {
		const dir = await makeTempDir();
		const { barePath, tag } = await createRepoWithStructure(dir, async (repoDir) => {
			await mkdir(join(repoDir, "agents"), { recursive: true });
			await writeFile(
				join(repoDir, "agents", "my-agent.md"),
				"---\nname: my-agent\n---\n# Agent\n",
			);
		});

		const result = await inferTypeFromGit(barePath, tag, "agents/my-agent.md");
		expect(result.type).toBe("agent");
		expect(result.resolvedPath).toBe("agents/my-agent.md");
	});

	test("symlink to skill directory → skill with resolved path", async () => {
		const dir = await makeTempDir();
		const { barePath, tag } = await createRepoWithStructure(dir, async (repoDir) => {
			// Real skill at a deep path
			await mkdir(join(repoDir, "src", "bundled", "my-skill"), { recursive: true });
			await writeFile(
				join(repoDir, "src", "bundled", "my-skill", "SKILL.md"),
				"---\nname: my-skill\n---\n",
			);
			// Symlink at skills/my-skill → ../src/bundled/my-skill
			await mkdir(join(repoDir, "skills"), { recursive: true });
			await symlink("../src/bundled/my-skill", join(repoDir, "skills", "my-skill"));
		});

		const result = await inferTypeFromGit(barePath, tag, "skills/my-skill");
		expect(result.type).toBe("skill");
		expect(result.resolvedPath).toBe("src/bundled/my-skill");
	});

	test("symlink to agent file → agent with resolved path", async () => {
		const dir = await makeTempDir();
		const { barePath, tag } = await createRepoWithStructure(dir, async (repoDir) => {
			await mkdir(join(repoDir, "src", "agents"), { recursive: true });
			await writeFile(join(repoDir, "src", "agents", "bot.md"), "---\nname: bot\n---\n# Bot\n");
			await mkdir(join(repoDir, "agents"), { recursive: true });
			await symlink("../src/agents/bot.md", join(repoDir, "agents", "bot.md"));
		});

		const result = await inferTypeFromGit(barePath, tag, "agents/bot.md");
		expect(result.type).toBe("agent");
		expect(result.resolvedPath).toBe("src/agents/bot.md");
	});

	test("directory without SKILL.md defaults to skill", async () => {
		const dir = await makeTempDir();
		const { barePath, tag } = await createRepoWithStructure(dir, async (repoDir) => {
			await mkdir(join(repoDir, "skills", "bare-dir"), { recursive: true });
			await writeFile(join(repoDir, "skills", "bare-dir", "README.md"), "# Not a SKILL.md\n");
		});

		const result = await inferTypeFromGit(barePath, tag, "skills/bare-dir");
		expect(result.type).toBe("skill");
	});

	test("root path '.' → skill", async () => {
		const dir = await makeTempDir();
		const { barePath, tag } = await createRepoWithStructure(dir, async (repoDir) => {
			await writeFile(join(repoDir, "SKILL.md"), "---\nname: root-skill\n---\n");
		});

		const result = await inferTypeFromGit(barePath, tag, ".");
		expect(result.type).toBe("skill");
	});
});
