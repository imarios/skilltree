import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_REGISTRY } from "../../src/core/agents.js";
import {
	getSkillAgentIgnoreEntries,
	getSkillAgentIgnoreEntriesForTarget,
	removeGitignoreEntries,
} from "../../src/core/gitignore.js";

async function withTempDir(fn: (dir: string) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), "skilltree-gitignore-"));
	try {
		await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe("getSkillAgentIgnoreEntries", () => {
	test("strips trailing slash and emits skills/agents/commands entries", () => {
		expect(getSkillAgentIgnoreEntries(".claude")).toEqual([
			".claude/skills/",
			".claude/agents/",
			".claude/commands/",
		]);
		expect(getSkillAgentIgnoreEntries(".claude/")).toEqual([
			".claude/skills/",
			".claude/agents/",
			".claude/commands/",
		]);
	});
});

describe("getSkillAgentIgnoreEntriesForTarget", () => {
	test("codex resolves through the agent registry to .agents/, not .codex/", () => {
		// Regression for #32: init.ts was synthesizing `.${target}` instead of
		// looking up the registry, so codex (dir: ".agents") got the wrong
		// gitignore entries written.
		const entries = getSkillAgentIgnoreEntriesForTarget("codex");
		expect(entries).toEqual([".agents/skills/", ".agents/agents/", ".agents/commands/"]);
		expect(entries.some((e) => e.startsWith(".codex/"))).toBe(false);
	});

	test("copilot resolves through the agent registry to .github/, not .copilot/", () => {
		// Regression for #32: same root cause as the codex case — copilot's
		// registered dir is ".github".
		const entries = getSkillAgentIgnoreEntriesForTarget("copilot");
		expect(entries).toEqual([".github/skills/", ".github/agents/", ".github/commands/"]);
		expect(entries.some((e) => e.startsWith(".copilot/"))).toBe(false);
	});

	test("agents whose dir matches dot-name are unaffected", () => {
		expect(getSkillAgentIgnoreEntriesForTarget("claude")).toEqual([
			".claude/skills/",
			".claude/agents/",
			".claude/commands/",
		]);
		expect(getSkillAgentIgnoreEntriesForTarget("cursor")[0]).toBe(".cursor/skills/");
		expect(getSkillAgentIgnoreEntriesForTarget("gemini")[0]).toBe(".gemini/skills/");
		expect(getSkillAgentIgnoreEntriesForTarget("windsurf")[0]).toBe(".windsurf/skills/");
	});

	test("literal path target is honored (passes through resolveTarget)", () => {
		expect(getSkillAgentIgnoreEntriesForTarget("./my-agent")).toEqual([
			"./my-agent/skills/",
			"./my-agent/agents/",
			"./my-agent/commands/",
		]);
	});

	test("every registered agent: gitignore entries share a prefix with the install dir", () => {
		// Lock the gitignore-to-install-dir invariant for every entry in the
		// registry. If a future agent is added with `dir !== `.${name}``, this
		// test prevents the same class of bug from re-appearing.
		for (const [name, entry] of Object.entries(AGENT_REGISTRY)) {
			const ignoreEntries = getSkillAgentIgnoreEntriesForTarget(name);
			for (const ig of ignoreEntries) {
				expect(ig.startsWith(`${entry.dir}/`)).toBe(true);
			}
		}
	});
});

describe("removeGitignoreEntries", () => {
	test("deletes .gitignore when removing the last meaningful entry", async () => {
		await withTempDir(async (dir) => {
			await writeFile(
				join(dir, ".gitignore"),
				".claude/skills/\n.claude/agents/\n.claude/commands/\n",
				"utf-8",
			);

			const removed = await removeGitignoreEntries(dir, [
				".claude/skills/",
				".claude/agents/",
				".claude/commands/",
			]);

			expect(removed).toEqual([".claude/skills/", ".claude/agents/", ".claude/commands/"]);
			expect(existsSync(join(dir, ".gitignore"))).toBe(false);
		});
	});

	test("deletes .gitignore when only comments and blanks remain", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, ".gitignore"), "# skilltree entries\n\n.claude/skills/\n", "utf-8");

			await removeGitignoreEntries(dir, [".claude/skills/"]);

			expect(existsSync(join(dir, ".gitignore"))).toBe(false);
		});
	});

	test("keeps unrelated entries after removing managed entries", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, ".gitignore"), "node_modules/\n.claude/skills/\n", "utf-8");

			const removed = await removeGitignoreEntries(dir, [".claude/skills/"]);

			expect(removed).toEqual([".claude/skills/"]);
			expect(await readFile(join(dir, ".gitignore"), "utf-8")).toBe("node_modules/\n");
		});
	});
});
