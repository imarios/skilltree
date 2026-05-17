import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import simpleGit from "simple-git";

/**
 * Create a local git repo with skills that have frontmatter dependencies.
 * Returns the repo path (usable as a file:// URL for cloning).
 */
export async function createTestRepo(
	baseDir: string,
	repoName: string,
	skills: Array<{
		path: string;
		name: string;
		dependencies?: string[];
		isAgent?: boolean;
	}>,
	tagVersion?: string,
	manifestYaml?: string,
): Promise<string> {
	const repoDir = join(baseDir, repoName);
	await mkdir(repoDir, { recursive: true });

	const git = simpleGit(repoDir);
	await git.init();
	// Configure git user for commits
	await git.addConfig("user.email", "test@test.com");
	await git.addConfig("user.name", "Test");

	for (const skill of skills) {
		const skillDir = join(repoDir, skill.path);

		if (skill.isAgent) {
			// Agent is a single .md file
			const parentDir = join(repoDir, skill.path.split("/").slice(0, -1).join("/"));
			await mkdir(parentDir, { recursive: true });
			const deps = skill.dependencies?.length
				? `dependencies:\n${skill.dependencies.map((d) => `  - ${d}`).join("\n")}`
				: "";
			await writeFile(
				join(repoDir, skill.path),
				`---\nname: ${skill.name}\n${deps}\n---\n\n# ${skill.name} Agent\n`,
			);
		} else {
			// Skill is a directory with SKILL.md
			await mkdir(skillDir, { recursive: true });
			const deps = skill.dependencies?.length
				? `dependencies:\n${skill.dependencies.map((d) => `  - ${d}`).join("\n")}`
				: "";
			await writeFile(
				join(skillDir, "SKILL.md"),
				`---\nname: ${skill.name}\n${deps}\n---\n\n# ${skill.name}\n\nSkill content here.\n`,
			);
		}
	}

	if (manifestYaml !== undefined) {
		await writeFile(join(repoDir, "skilltree.yml"), manifestYaml);
	}

	await git.add(".");
	await git.commit("Initial commit");

	if (tagVersion) {
		await git.addTag(tagVersion);
	}

	return repoDir;
}

/**
 * Add a new tag to an existing test repo and update its bare clone.
 * Optionally modify a skill's content before tagging.
 */
export async function addTagToRepo(
	repoDir: string,
	bareDir: string,
	tagVersion: string,
	modifications?: Array<{
		path: string;
		name: string;
		dependencies?: string[];
		isAgent?: boolean;
	}>,
): Promise<void> {
	const git = simpleGit(repoDir);

	if (modifications) {
		for (const skill of modifications) {
			const skillDir = join(repoDir, skill.path);

			if (skill.isAgent) {
				const parentDir = join(repoDir, skill.path.split("/").slice(0, -1).join("/"));
				await mkdir(parentDir, { recursive: true });
				const deps = skill.dependencies?.length
					? `dependencies:\n${skill.dependencies.map((d) => `  - ${d}`).join("\n")}`
					: "";
				await writeFile(
					join(repoDir, skill.path),
					`---\nname: ${skill.name}\n${deps}\n---\n\n# ${skill.name} Agent v2\n`,
				);
			} else {
				await mkdir(skillDir, { recursive: true });
				const deps = skill.dependencies?.length
					? `dependencies:\n${skill.dependencies.map((d) => `  - ${d}`).join("\n")}`
					: "";
				await writeFile(
					join(skillDir, "SKILL.md"),
					`---\nname: ${skill.name}\n${deps}\n---\n\n# ${skill.name}\n\nUpdated content for ${tagVersion}.\n`,
				);
			}
		}

		await git.add(".");
		await git.commit(`Update for ${tagVersion}`);
	}

	await git.addTag(tagVersion);

	// Update the bare clone
	const bareGit = simpleGit(bareDir);
	await bareGit.raw([
		"fetch",
		`file://${repoDir}`,
		"+refs/tags/*:refs/tags/*",
		"+refs/heads/*:refs/heads/*",
	]);
}

/**
 * Create a local skill directory (not a git repo) for local dep testing.
 *
 * The fixture writes a well-formed frontmatter (name + description) so the
 * file passes `skilltree check`'s frontmatter lint by default — tests that
 * need malformed frontmatter should write SKILL.md directly.
 */
export async function createLocalSkill(
	baseDir: string,
	name: string,
	dependencies?: string[],
): Promise<string> {
	const skillDir = join(baseDir, name);
	await mkdir(skillDir, { recursive: true });

	const deps = dependencies?.length
		? `dependencies:\n${dependencies.map((d) => `  - ${d}`).join("\n")}`
		: "";

	await writeFile(
		join(skillDir, "SKILL.md"),
		`---\nname: ${name}\ndescription: Test skill ${name}\n${deps}\n---\n\n# ${name}\n`,
	);

	return skillDir;
}
