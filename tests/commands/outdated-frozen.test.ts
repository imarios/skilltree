/**
 * Neon Phase 2 (#203): `outdated` reports frozen deps as frozen.
 *
 * A frozen dep with newer tags isn't drift the user forgot about — they chose
 * it. The row still shows what's available, marks it frozen, and `--check`
 * (the CI gate) ignores it. A frozen dep also can't cap its siblings, so it
 * must not show up in their `cappedBy`.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { installCommand } from "../../src/commands/install.js";
import { type OutdatedRow, outdatedCommand } from "../../src/commands/outdated.js";
import { addTagToRepo, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string | undefined;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
	tempDir = undefined;
	process.exitCode = 0;
});

const SKILLS = [
	{ path: "skills/stable", name: "stable" },
	{ path: "skills/other", name: "other" },
];

/**
 * Upstream at v0.4.0 and v0.6.0. `stable` is frozen at 0.4.0; `other`, when
 * included, is `*`. After install, upstream optionally tags v0.7.0 so `other`
 * has drift of its own.
 */
async function project(opts: { withOther: boolean; upstreamMoves: boolean }): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "skilltree-outdated-frozen-"));
	tempDir = dir;
	const repoDir = await createTestRepo(dir, "upstream", SKILLS, "v0.4.0");
	const bareDir = join(dir, "upstream.git");
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	await addTagToRepo(repoDir, bareDir, "v0.6.0", SKILLS);

	const projectDir = join(dir, "project");
	await mkdir(projectDir, { recursive: true });
	const other = opts.withOther
		? `  other:
    repo: "file://${bareDir}"
    path: skills/other
    type: skill
    version: "*"
`
		: "";
	await writeFile(
		join(projectDir, "skilltree.yml"),
		`dependencies:
  stable:
    repo: "file://${bareDir}"
    path: skills/stable
    type: skill
    frozen: "0.4.0"
${other}`,
	);
	await installCommand(projectDir, {});
	if (opts.upstreamMoves) await addTagToRepo(repoDir, bareDir, "v0.7.0", SKILLS);
	return projectDir;
}

async function captureLogs(run: () => Promise<void>): Promise<string> {
	const logs: string[] = [];
	const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		logs.push(args.join(" "));
	});
	try {
		await run();
	} finally {
		spy.mockRestore();
	}
	return logs.join("\n");
}

async function jsonRows(projectDir: string): Promise<OutdatedRow[]> {
	const output = await captureLogs(() => outdatedCommand(projectDir, undefined, { json: true }));
	return JSON.parse(output) as OutdatedRow[];
}

describe("outdated: frozen deps (#203)", () => {
	test("OD1 a frozen row reports frozenAt and what's available, with no pin or cap attribution", async () => {
		const projectDir = await project({ withOther: true, upstreamMoves: true });

		const stable = (await jsonRows(projectDir)).find((r) => r.name === "stable");

		expect(stable?.frozenAt).toBe("0.4.0");
		expect(stable?.latest).toBe("0.7.0");
		expect(stable?.pinnedAt).toBeNull();
		expect(stable?.cappedBy).toBeNull();
	});

	test("OD2 a frozen dep is not listed as capping its `*` sibling", async () => {
		const projectDir = await project({ withOther: true, upstreamMoves: true });

		const other = (await jsonRows(projectDir)).find((r) => r.name === "other");

		expect(other?.frozenAt).toBeNull();
		expect(other?.cappedBy).toBeNull();
	});

	test("OD3 --check ignores frozen drift but still fails on unfrozen drift", async () => {
		const frozenOnly = await project({ withOther: false, upstreamMoves: false });
		await captureLogs(() => outdatedCommand(frozenOnly, undefined, { check: true }));
		expect(process.exitCode ?? 0).toBe(0);

		await rm(tempDir as string, { recursive: true, force: true });
		const withDrift = await project({ withOther: true, upstreamMoves: true });
		await captureLogs(() => outdatedCommand(withDrift, undefined, { check: true }));
		expect(process.exitCode).toBe(1);
	});

	test("OD4 the table marks the frozen row", async () => {
		const projectDir = await project({ withOther: false, upstreamMoves: false });

		const output = await captureLogs(() => outdatedCommand(projectDir));

		expect(output).toContain("frozen at 0.4.0");
	});
});
