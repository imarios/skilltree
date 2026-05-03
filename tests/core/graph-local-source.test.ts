import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAll } from "../../src/core/graph.js";
import type { Dependency, Manifest } from "../../src/types.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-local-source-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

/**
 * Create a skill directory with SKILL.md.
 */
async function createSkill(dir: string, name: string, dependencies?: string[]): Promise<void> {
	const skillDir = join(dir, name);
	await mkdir(skillDir, { recursive: true });
	const deps = dependencies?.length
		? `dependencies:\n${dependencies.map((d) => `  - ${d}`).join("\n")}`
		: "";
	await writeFile(join(skillDir, "SKILL.md"), `---\nname: ${name}\n${deps}\n---\n\n# ${name}\n`);
}

describe("same-origin resolution for local sources", () => {
	test("resolves transitive dep from same local source directory", async () => {
		const dir = await makeTempDir();

		// Create a local source directory with two skills
		const sourceDir = join(dir, "my-skills");
		await createSkill(join(sourceDir, "skills"), "python-coding", ["testing"]);
		await createSkill(join(sourceDir, "skills"), "testing");

		// Project directory
		const projectDir = join(dir, "project");
		await mkdir(projectDir, { recursive: true });

		const manifest: Manifest = {
			sources: { mine: sourceDir },
			dependencies: {
				"python-coding": {
					source: "mine",
					path: "skills/python-coding",
				} as Dependency,
			},
		};

		const result = await resolveAll(manifest, projectDir);

		expect(result.errors).toEqual([]);
		expect(result.entities.size).toBe(2);
		expect(result.entities.has("skill:python-coding")).toBe(true);
		expect(result.entities.has("skill:testing")).toBe(true);

		// Verify testing was resolved via same-origin
		const testing = result.entities.get("skill:testing");
		expect(testing?.local).toBe(true);
		expect(testing?.sourceDir).toBe(sourceDir);
	});

	test("errors when transitive dep not found in local source", async () => {
		const dir = await makeTempDir();

		const sourceDir = join(dir, "my-skills");
		await createSkill(join(sourceDir, "skills"), "python-coding", ["nonexistent"]);

		const projectDir = join(dir, "project");
		await mkdir(projectDir, { recursive: true });

		const manifest: Manifest = {
			sources: { mine: sourceDir },
			dependencies: {
				"python-coding": {
					source: "mine",
					path: "skills/python-coding",
				} as Dependency,
			},
		};

		const result = await resolveAll(manifest, projectDir);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0]).toContain("nonexistent");
	});

	test("standalone local dep has no same-origin (requires manifest entry)", async () => {
		const dir = await makeTempDir();

		// Create skills in a directory
		const skillsDir = join(dir, "skills");
		await createSkill(skillsDir, "my-skill", ["testing"]);
		await createSkill(skillsDir, "testing");

		const projectDir = join(dir, "project");
		await mkdir(projectDir, { recursive: true });

		// Standalone local: dep (no source, just direct path)
		const manifest: Manifest = {
			dependencies: {
				"my-skill": {
					local: join(skillsDir, "my-skill"),
				},
			},
		};

		const result = await resolveAll(manifest, projectDir);
		// Should error because standalone local has no same-origin
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0]).toContain("testing");
	});

	test("manifest entry takes precedence over same-origin", async () => {
		const dir = await makeTempDir();

		const sourceDir = join(dir, "my-skills");
		await createSkill(join(sourceDir, "skills"), "python-coding", ["testing"]);
		await createSkill(join(sourceDir, "skills"), "testing");

		// Create a different testing skill in a separate location
		const otherDir = join(dir, "other-skills");
		await createSkill(otherDir, "testing");

		const projectDir = join(dir, "project");
		await mkdir(projectDir, { recursive: true });

		const manifest: Manifest = {
			sources: { mine: sourceDir },
			dependencies: {
				"python-coding": {
					source: "mine",
					path: "skills/python-coding",
				} as Dependency,
				// Explicit manifest entry for testing (takes precedence)
				testing: {
					local: join(otherDir, "testing"),
				},
			},
		};

		const result = await resolveAll(manifest, projectDir);
		expect(result.errors).toEqual([]);

		// testing should come from the manifest entry, not same-origin
		const testing = result.entities.get("skill:testing");
		expect(testing?.path).toContain("other-skills");
	});

	test("resolves transitive agent from same local source", async () => {
		const dir = await makeTempDir();

		const sourceDir = join(dir, "my-skills");

		// Create a skill that depends on an agent
		await createSkill(join(sourceDir, "skills"), "python-coding", ["code-reviewer"]);

		// Create the agent
		const agentDir = join(sourceDir, "agents");
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			join(agentDir, "code-reviewer.md"),
			"---\nname: code-reviewer\n---\n\n# Code Reviewer Agent\n",
		);

		const projectDir = join(dir, "project");
		await mkdir(projectDir, { recursive: true });

		const manifest: Manifest = {
			sources: { mine: sourceDir },
			dependencies: {
				"python-coding": {
					source: "mine",
					path: "skills/python-coding",
				} as Dependency,
			},
		};

		const result = await resolveAll(manifest, projectDir);

		// Skill→agent is allowed (issue #45). The transitive agent must
		// resolve from the same local source via the candidate probe.
		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:python-coding")).toBeDefined();
		expect(result.entities.get("agent:code-reviewer")).toBeDefined();
	});

	test("same-origin works with tilde-expanded paths", async () => {
		const dir = await makeTempDir();

		const sourceDir = join(dir, "my-skills");
		await createSkill(join(sourceDir, "skills"), "skill-a", ["skill-b"]);
		await createSkill(join(sourceDir, "skills"), "skill-b");

		const projectDir = join(dir, "project");
		await mkdir(projectDir, { recursive: true });

		// Simulate what expandSources produces for a tilde source
		// (tilde is already expanded at this point)
		const manifest: Manifest = {
			sources: { mine: sourceDir },
			dependencies: {
				"skill-a": {
					source: "mine",
					path: "skills/skill-a",
				} as Dependency,
			},
		};

		const result = await resolveAll(manifest, projectDir);
		expect(result.errors).toEqual([]);
		expect(result.entities.has("skill:skill-a")).toBe(true);
		expect(result.entities.has("skill:skill-b")).toBe(true);
	});
});
