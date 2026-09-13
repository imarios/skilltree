/**
 * Neon Phase 2 (#203): `update` leaves frozen deps where they are, and says so.
 *
 * Resolution already keeps a frozen dep at its tag. What `update` owes the
 * user is the sentence explaining why that dep didn't move, and, for
 * `update <frozen dep>`, not pretending to do anything.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { installCommand } from "../../src/commands/install.js";
import { updateCommand } from "../../src/commands/update.js";
import { readLockfile } from "../../src/core/lockfile.js";
import { addTagToRepo, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string | undefined;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
	tempDir = undefined;
});

const SKILLS = [
	{ path: "skills/stable", name: "stable" },
	{ path: "skills/other", name: "other" },
];

interface Fixture {
	projectDir: string;
	repoDir: string;
	bareDir: string;
}

/** stable frozen at 0.4.0 and other at `*`, installed; upstream then tags v0.7.0. */
async function installedThenUpstreamMoves(): Promise<Fixture> {
	const dir = await mkdtemp(join(tmpdir(), "skilltree-update-frozen-"));
	tempDir = dir;
	const repoDir = await createTestRepo(dir, "upstream", SKILLS, "v0.4.0");
	const bareDir = join(dir, "upstream.git");
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	await addTagToRepo(repoDir, bareDir, "v0.6.0", SKILLS);

	const projectDir = join(dir, "project");
	await mkdir(projectDir, { recursive: true });
	await writeFile(
		join(projectDir, "skilltree.yml"),
		`dependencies:
  stable:
    repo: "file://${bareDir}"
    path: skills/stable
    type: skill
    frozen: "0.4.0"
  other:
    repo: "file://${bareDir}"
    path: skills/other
    type: skill
    version: "*"
`,
	);
	await installCommand(projectDir, {});
	await addTagToRepo(repoDir, bareDir, "v0.7.0", SKILLS);
	return { projectDir, repoDir, bareDir };
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

describe("update: frozen deps (#203)", () => {
	test("UP1 update moves unfrozen siblings, keeps the frozen dep, and says why", async () => {
		const fx = await installedThenUpstreamMoves();

		const output = await captureLogs(() => updateCommand(fx.projectDir));

		const packages = (await readLockfile(fx.projectDir))?.packages;
		expect(packages?.other?.version).toBe("0.7.0");
		expect(packages?.stable?.version).toBe("0.4.0");
		expect(output).toContain("stable: frozen at 0.4.0");
		expect(output).toContain("skilltree unfreeze stable");
	});

	test("UP2 update <frozen dep> explains and changes nothing", async () => {
		const fx = await installedThenUpstreamMoves();
		const lockBefore = await readFile(join(fx.projectDir, "skilltree.lock"), "utf-8");

		const output = await captureLogs(() => updateCommand(fx.projectDir, "stable"));

		expect(output).toContain('"stable" is frozen at 0.4.0');
		expect(output).toContain("skilltree unfreeze stable");
		expect(await readFile(join(fx.projectDir, "skilltree.lock"), "utf-8")).toBe(lockBefore);
	});

	test("UP3 no 'pinned at' constraint note for a frozen dep", async () => {
		const fx = await installedThenUpstreamMoves();

		const output = await captureLogs(() => updateCommand(fx.projectDir, "stable"));

		expect(output).not.toContain("is pinned at");
	});
});
