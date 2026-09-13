import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand } from "../../src/commands/install.js";
import { verifyCommand } from "../../src/commands/verify.js";
import { createLocalSkill, createTestRepo } from "../helpers/git-fixtures.js";

/**
 * #205: `verify` reports install-tree entries skilltree didn't install.
 *
 * Pruning only removes what the lockfile records, so anything left over from
 * before there was a lockfile, or placed by hand, was invisible: `verify` only
 * walked entities it knew about. These are listed as EXTRANEOUS so the state is
 * visible, but they are a warning, not drift — a hand-placed skill is a
 * legitimate thing to have, so `--strict` must not fail on it.
 */

let tempDir: string;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-verify-extraneous-"));
	return tempDir;
}

async function installedProject(extraManifest = ""): Promise<string> {
	const dir = await makeTempDir();
	await createLocalSkill(join(dir, "skills"), "my-skill");
	await writeFile(
		join(dir, "skilltree.yml"),
		`${extraManifest}dependencies:\n  my-skill:\n    local: ./skills/my-skill\n`,
	);
	await installCommand(dir, {});
	return dir;
}

async function handPlacedSkill(installBase: string, name: string): Promise<void> {
	await mkdir(join(installBase, "skills", name), { recursive: true });
	await writeFile(join(installBase, "skills", name, "SKILL.md"), `---\nname: ${name}\n---\n`);
}

async function runVerify(
	dir: string,
	opts: Parameters<typeof verifyCommand>[1] = {},
): Promise<{ output: string; failed: boolean }> {
	const lines: string[] = [];
	const log = console.log;
	const warn = console.warn;
	console.log = (...args: unknown[]) => lines.push(args.join(" "));
	console.warn = (...args: unknown[]) => lines.push(args.join(" "));
	const exitBefore = process.exitCode;
	try {
		await verifyCommand(dir, opts);
	} finally {
		console.log = log;
		console.warn = warn;
	}
	const failed = process.exitCode === 1;
	// Bun does not treat assigning `undefined` as a reset (#212).
	process.exitCode = exitBefore ?? 0;
	return { output: lines.join("\n"), failed };
}

describe("verify reports entries skilltree didn't install (#205)", () => {
	test("a clean install reports nothing extraneous", async () => {
		const dir = await installedProject();
		const { output } = await runVerify(dir);
		expect(output).not.toContain("EXTRANEOUS");
	});

	test("lists a hand-placed skill as EXTRANEOUS", async () => {
		const dir = await installedProject();
		await handPlacedSkill(join(dir, ".claude"), "hand-placed");

		const { output } = await runVerify(dir);

		expect(output).toContain("hand-placed");
		expect(output).toContain("EXTRANEOUS");
	});

	test("stray agents and commands count too", async () => {
		const dir = await installedProject();
		await mkdir(join(dir, ".claude/agents"), { recursive: true });
		await mkdir(join(dir, ".claude/commands"), { recursive: true });
		await writeFile(join(dir, ".claude/agents/stray-agent.md"), "---\nname: stray-agent\n---\n");
		await writeFile(join(dir, ".claude/commands/stray-command.md"), "# stray\n");

		const { output } = await runVerify(dir);

		expect(output).toContain("stray-agent");
		expect(output).toContain("stray-command");
	});

	test("ignores files that aren't entities", async () => {
		const dir = await installedProject();
		await writeFile(join(dir, ".claude/skills/.DS_Store"), "");
		await mkdir(join(dir, ".claude/agents"), { recursive: true });
		await writeFile(join(dir, ".claude/agents/notes.txt"), "not an agent\n");

		const { output } = await runVerify(dir);

		expect(output).not.toContain(".DS_Store");
		expect(output).not.toContain("notes");
		expect(output).not.toContain("EXTRANEOUS");
	});

	test("an installed aliased entity is not extraneous", async () => {
		const dir = await makeTempDir();
		const repo = await createTestRepo(
			dir,
			"remote",
			[{ path: "skills/bar", name: "bar" }],
			"1.0.0",
		);
		await writeFile(
			join(dir, "skilltree.yml"),
			`dependencies:\n  my-bar:\n    repo: file://${repo}\n    path: skills/bar\n    version: "*"\n    name: bar\n`,
		);
		await installCommand(dir, {});

		const { output } = await runVerify(dir);

		expect(output).not.toContain("EXTRANEOUS");
	});

	test("--strict does not fail on extraneous entries", async () => {
		const dir = await installedProject();
		await handPlacedSkill(join(dir, ".claude"), "hand-placed");

		const { failed } = await runVerify(dir, { strict: true });

		expect(failed).toBe(false);
	});

	test("--json includes extraneous rows", async () => {
		const dir = await installedProject();
		await handPlacedSkill(join(dir, ".claude"), "hand-placed");

		const { output } = await runVerify(dir, { json: true });
		const rows = JSON.parse(output) as Array<{ name: string; status: string }>;

		expect(rows).toContainEqual({ name: "hand-placed", status: "extraneous" });
	});

	test("every install target is scanned", async () => {
		const dir = await installedProject("install_targets:\n  - claude\n  - cursor\n");
		await handPlacedSkill(join(dir, ".cursor"), "cursor-stray");

		const { output } = await runVerify(dir);

		expect(output).toContain("cursor-stray");
	});
});
