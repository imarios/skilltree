import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCommand } from "../../src/commands/init.js";

/**
 * #157: `init` offers to install the bundled skilltree skill when a detected
 * agent is missing it.
 *
 * Until now a first-time user only learned about `skilltree teach` from
 * `doctor`'s remediation line — and only if they happened to run `doctor`.
 *
 * `teachFn` stands in for the real `teach`, which writes into the agent's
 * global config. These tests are about init's decision, not teach's effect,
 * and must never write outside the temp dir.
 */

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function setup(opts: { skillInstalled?: boolean; agents?: string[] } = {}) {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-init-teach-"));
	const project = join(tempDir, "project");
	const home = join(tempDir, "home");
	await mkdir(project, { recursive: true });
	for (const agent of opts.agents ?? [".claude"]) {
		await mkdir(join(home, agent), { recursive: true });
	}
	if (opts.skillInstalled) {
		const skillDir = join(home, ".claude", "skills", "skilltree");
		await mkdir(skillDir, { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), "---\nname: skilltree\nversion: 999.0.0\n---\n");
	}
	return { project, home, globalDir: join(tempDir, "global") };
}

function recorder() {
	const calls: Array<{ homeDir?: string; globalDir?: string }> = [];
	const teachFn = async (o: { homeDir?: string; globalDir?: string }) => {
		calls.push(o);
	};
	return { calls, teachFn };
}

async function captureLogs(fn: () => Promise<void>): Promise<string> {
	const lines: string[] = [];
	const log = console.log;
	console.log = (m?: unknown) => {
		lines.push(String(m));
	};
	try {
		await fn();
	} finally {
		console.log = log;
	}
	return lines.join("\n");
}

describe("init offers teach when the bundled skill is missing (#157)", () => {
	test("interactive yes runs teach with the same home and global dirs", async () => {
		const { project, home, globalDir } = await setup();
		const { calls, teachFn } = recorder();
		const questions: string[] = [];

		await captureLogs(() =>
			initCommand(project, {
				homeDir: home,
				globalDir,
				isInteractive: true,
				askFn: async (q) => {
					questions.push(q);
					return "y";
				},
				teachFn,
			}),
		);

		expect(questions.some((q) => /install it now/i.test(q))).toBe(true);
		expect(calls).toEqual([{ homeDir: home, globalDir }]);
	});

	test("an empty answer accepts the recommended default", async () => {
		const { project, home, globalDir } = await setup();
		const { calls, teachFn } = recorder();

		await captureLogs(() =>
			initCommand(project, {
				homeDir: home,
				globalDir,
				isInteractive: true,
				askFn: async () => "",
				teachFn,
			}),
		);

		expect(calls.length).toBe(1);
	});

	test("interactive no skips teach and says how to do it later", async () => {
		const { project, home, globalDir } = await setup();
		const { calls, teachFn } = recorder();

		const out = await captureLogs(() =>
			initCommand(project, {
				homeDir: home,
				globalDir,
				isInteractive: true,
				askFn: async () => "n",
				teachFn,
			}),
		);

		expect(calls.length).toBe(0);
		expect(out).toContain("skilltree teach");
	});

	test("--yes runs teach without asking", async () => {
		const { project, home, globalDir } = await setup();
		const { calls, teachFn } = recorder();
		let asked = false;

		await captureLogs(() =>
			initCommand(project, {
				homeDir: home,
				globalDir,
				yes: true,
				isInteractive: true,
				askFn: async () => {
					asked = true;
					return "n";
				},
				teachFn,
			}),
		);

		expect(asked).toBe(false);
		expect(calls.length).toBe(1);
	});

	test("non-interactive prints a hint and writes nothing outside the project", async () => {
		const { project, home, globalDir } = await setup();
		const { calls, teachFn } = recorder();

		const out = await captureLogs(() =>
			initCommand(project, { homeDir: home, globalDir, isInteractive: false, teachFn }),
		);

		expect(calls.length).toBe(0);
		expect(out).toContain("skilltree teach");
	});

	test("no offer when the skill is already installed", async () => {
		const { project, home, globalDir } = await setup({ skillInstalled: true });
		const { calls, teachFn } = recorder();
		const questions: string[] = [];

		const out = await captureLogs(() =>
			initCommand(project, {
				homeDir: home,
				globalDir,
				isInteractive: true,
				askFn: async (q) => {
					questions.push(q);
					return "y";
				},
				teachFn,
			}),
		);

		expect(calls.length).toBe(0);
		expect(questions.some((q) => /install it now/i.test(q))).toBe(false);
		expect(out).not.toContain("skilltree teach");
	});

	test("no offer when no agents are detected", async () => {
		const { project, home, globalDir } = await setup({ agents: [] });
		const { calls, teachFn } = recorder();

		const out = await captureLogs(() =>
			initCommand(project, { homeDir: home, globalDir, isInteractive: false, teachFn }),
		);

		expect(calls.length).toBe(0);
		expect(out).not.toContain("skilltree teach");
	});
});
