import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frontmatterPath, inferEntityType } from "../../src/core/entity-type.js";
import type { EntityType } from "../../src/types.js";

/**
 * Issue #166: the "given a local path, what entity is this and which .md do I
 * read?" question was answered by two independent implementations —
 * `inferType` in graph.ts and `resolveEntityMdPath` in check.ts. They had
 * already drifted once (before #162, `check` declined to classify probed
 * single-file entities while `install` classified them), so the two commands
 * disagreed about the same file.
 *
 * These are the unit tests for the centralized helpers both now call.
 * Parametrized per CLAUDE.md pattern #4: a new edge case is a new row, and the
 * helper gets the fix in one place.
 */

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-entity-type-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("frontmatterPath", () => {
	const cases: Array<{ path: string; type: EntityType; expected: string; why: string }> = [
		{ path: "skills/foo", type: "skill", expected: "skills/foo/SKILL.md", why: "skill dir" },
		{ path: "agents/foo.md", type: "agent", expected: "agents/foo.md", why: "agent is the file" },
		{
			path: "commands/foo.md",
			type: "command",
			expected: "commands/foo.md",
			why: "command is the file",
		},
		{
			path: "skills/foo/",
			type: "skill",
			expected: "skills/foo/SKILL.md",
			why: "trailing slash normalizes",
		},
		{ path: ".", type: "skill", expected: "SKILL.md", why: "project-root skill" },
	];

	for (const { path, type, expected, why } of cases) {
		test(`${why}: (${path}, ${type}) -> ${expected}`, () => {
			expect(frontmatterPath(path, type)).toBe(expected);
		});
	}
});

describe("inferEntityType", () => {
	test("directory containing SKILL.md is a skill", async () => {
		const dir = await makeTempDir();
		await mkdir(join(dir, "foo"), { recursive: true });
		await writeFile(join(dir, "foo", "SKILL.md"), "---\nname: foo\n---\n", "utf-8");

		expect(await inferEntityType(join(dir, "foo"))).toBe("skill");
	});

	test("directory without SKILL.md is still a skill", async () => {
		// Matches the pre-refactor probe: a directory is a skill by layout, and
		// the missing SKILL.md is reported by the caller, not by classification.
		const dir = await makeTempDir();
		await mkdir(join(dir, "bare"), { recursive: true });

		expect(await inferEntityType(join(dir, "bare"))).toBe("skill");
	});

	test(".md under a commands/ segment is a command", async () => {
		const dir = await makeTempDir();
		await mkdir(join(dir, "commands"), { recursive: true });
		await writeFile(join(dir, "commands", "deploy.md"), "---\n---\n", "utf-8");

		expect(await inferEntityType(join(dir, "commands", "deploy.md"))).toBe("command");
	});

	test(".md outside commands/ is an agent", async () => {
		const dir = await makeTempDir();
		await mkdir(join(dir, "agents"), { recursive: true });
		await writeFile(join(dir, "agents", "helper.md"), "---\n---\n", "utf-8");

		expect(await inferEntityType(join(dir, "agents", "helper.md"))).toBe("agent");
	});

	test("a non-.md file is unclassifiable", async () => {
		// `undefined`, not a guessed "skill": check surfaces this as a bad path
		// so the author sees what confused the probe, while install falls back.
		const dir = await makeTempDir();
		await writeFile(join(dir, "notes.txt"), "hi", "utf-8");

		expect(await inferEntityType(join(dir, "notes.txt"))).toBeUndefined();
	});

	test("a path that does not exist is unclassifiable", async () => {
		const dir = await makeTempDir();
		expect(await inferEntityType(join(dir, "nope"))).toBeUndefined();
	});
});
