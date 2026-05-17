import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand } from "../../src/commands/install.js";
import { whyCommand } from "../../src/commands/why.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

/**
 * Tests for `skilltree why <name>` — reverse-lookup which top-level deps
 * pulled in a given entity. Issue #80.
 *
 * The command reads the lockfile only (never writes) and walks the resolved
 * graph backwards from the target to every reachable top-level dependency.
 */

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-why-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function writeManifest(dir: string, content: string): Promise<void> {
	await writeFile(join(dir, "skilltree.yml"), content, "utf-8");
}

function stripAnsi(s: string): string {
	// biome-ignore lint: regex for ANSI stripping
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function captureConsole(fn: () => Promise<void>): Promise<string[]> {
	const lines: string[] = [];
	const original = console.log;
	console.log = (...args: unknown[]) => lines.push(args.join(" "));
	return fn()
		.then(() => lines.map(stripAnsi))
		.finally(() => {
			console.log = original;
		});
}

describe("why command", () => {
	test("single-path: target reached through one top-level dep", async () => {
		const dir = await makeTempDir();
		// task-builder → python-coding
		await createLocalSkill(join(dir, "skills"), "python-coding");
		await createLocalSkill(join(dir, "skills"), "task-builder", ["python-coding"]);

		await writeManifest(
			dir,
			[
				"dependencies:",
				"  task-builder:",
				"    local: ./skills/task-builder",
				"  python-coding:",
				"    local: ./skills/python-coding",
				"",
			].join("\n"),
		);
		await installCommand(dir, {});

		const lines = await captureConsole(() => whyCommand("python-coding", { dir }));

		// Header line
		expect(lines[0]).toContain("python-coding");
		// Path line should mention the top-level dep and that it's top-level
		const pathLines = lines.slice(1);
		expect(pathLines.some((l) => l.includes("task-builder") && l.includes("top-level"))).toBe(true);
	});

	test("multi-path: target reached through two top-level deps (diamond)", async () => {
		const dir = await makeTempDir();
		// Diamond: left → shared, right → shared, root → left, root → right
		await createLocalSkill(join(dir, "skills"), "shared");
		await createLocalSkill(join(dir, "skills"), "left", ["shared"]);
		await createLocalSkill(join(dir, "skills"), "right", ["shared"]);
		await createLocalSkill(join(dir, "skills"), "root", ["left", "right"]);

		await writeManifest(
			dir,
			[
				"dependencies:",
				"  root:",
				"    local: ./skills/root",
				"  left:",
				"    local: ./skills/left",
				"  right:",
				"    local: ./skills/right",
				"  shared:",
				"    local: ./skills/shared",
				"",
			].join("\n"),
		);
		await installCommand(dir, {});

		const lines = await captureConsole(() => whyCommand("shared", { dir }));

		const pathLines = lines.slice(1);
		// At minimum two paths: one via left and one via right (both reach root too).
		// Each path text contains the intermediate name.
		expect(pathLines.some((l) => l.includes("left"))).toBe(true);
		expect(pathLines.some((l) => l.includes("right"))).toBe(true);
		// shared is also top-level itself, so a "top-level" line should appear too
		// — but per spec, a target that IS top-level is reported separately. Here
		// shared is BOTH top-level AND a transitive of root, so transitive paths
		// should still surface.
	});

	test("target is itself a top-level dep with no upstream chain", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "solo");

		await writeManifest(dir, "dependencies:\n  solo:\n    local: ./skills/solo\n");
		await installCommand(dir, {});

		const lines = await captureConsole(() => whyCommand("solo", { dir }));
		// Should explicitly tell the user it's a top-level dep with no upstream.
		const all = lines.join("\n");
		expect(all).toContain("solo");
		expect(all.toLowerCase()).toContain("top-level");
	});

	test("missing target errors with install hint", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "only");
		await writeManifest(dir, "dependencies:\n  only:\n    local: ./skills/only\n");
		await installCommand(dir, {});

		await expect(whyCommand("does-not-exist", { dir })).rejects.toThrow(/not in skilltree\.lock/);
	});

	test("no lockfile errors with install hint", async () => {
		const dir = await makeTempDir();
		await writeManifest(dir, "dependencies: {}\n");

		await expect(whyCommand("anything", { dir })).rejects.toThrow(/skilltree install/);
	});

	test("name collision: skill+agent same name requires --type", async () => {
		const dir = await makeTempDir();
		// Two top-level deps that resolve to the same name but different types,
		// using YAML key aliasing.
		await createLocalSkill(join(dir, "skills"), "fooskill");
		// Agent .md file (single-file entity)
		await writeFile(join(dir, "skills", "fooskill", "alias.md"), "---\nname: foo\n---\nbody\n");
		// Local agent file at top-level
		const agentPath = join(dir, "agents");
		await writeFile(join(await mkdtempAgents(agentPath), "foo.md"), "---\nname: foo\n---\nbody\n");

		await writeManifest(
			dir,
			[
				"dependencies:",
				"  foo-skill:",
				"    local: ./skills/fooskill",
				"    name: foo",
				"    type: skill",
				"  foo-agent:",
				"    local: ./agents/foo.md",
				"    name: foo",
				"    type: agent",
				"",
			].join("\n"),
		);
		await installCommand(dir, {});

		// Without --type: ambiguous
		await expect(whyCommand("foo", { dir })).rejects.toThrow(/--type/);

		// With --type: resolves
		const lines = await captureConsole(() => whyCommand("foo", { dir, type: "agent" }));
		expect(lines.join("\n")).toContain("foo");
	});

	test("--json shape: top-level direct path", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "python-coding");
		await createLocalSkill(join(dir, "skills"), "task-builder", ["python-coding"]);

		await writeManifest(
			dir,
			[
				"dependencies:",
				"  task-builder:",
				"    local: ./skills/task-builder",
				"  python-coding:",
				"    local: ./skills/python-coding",
				"",
			].join("\n"),
		);
		await installCommand(dir, {});

		const lines = await captureConsole(() => whyCommand("python-coding", { dir, json: true }));
		const out = JSON.parse(lines.join("\n"));
		expect(out.name).toBe("python-coding");
		expect(out.type).toBe("skill");
		expect(Array.isArray(out.paths)).toBe(true);
		expect(out.paths.length).toBeGreaterThanOrEqual(1);
		// First entry of each path is the top-level dep, with a `group` set.
		const firstPath = out.paths[0];
		expect(firstPath[0].name).toBe("task-builder");
		expect(firstPath[0].group).toBe("dependencies");
	});

	test("--json shape: target IS a top-level dep", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "solo");
		await writeManifest(dir, "dependencies:\n  solo:\n    local: ./skills/solo\n");
		await installCommand(dir, {});

		const lines = await captureConsole(() => whyCommand("solo", { dir, json: true }));
		const out = JSON.parse(lines.join("\n"));
		expect(out.name).toBe("solo");
		// Top-level case: paths is an empty array, but a `top_level` field
		// records the group so consumers can detect it cleanly.
		expect(out.paths).toEqual([]);
		expect(out.top_level).toBe("dependencies");
	});
});

// Helper: create the "agents" directory and return it. Inline to avoid
// adding another helper module for one test.
async function mkdtempAgents(p: string): Promise<string> {
	const { mkdir } = await import("node:fs/promises");
	await mkdir(p, { recursive: true });
	return p;
}
