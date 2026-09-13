/**
 * Neon Phase 3 (#203): outside the resolver, a respelled repo URL is still the
 * same repo — for lockfile staleness, `outdated`'s sibling caps, selective
 * `update`'s same-repo clearing, and `canonicalSource`.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { installCommand } from "../../src/commands/install.js";
import { type OutdatedRow, outdatedCommand } from "../../src/commands/outdated.js";
import { updateCommand } from "../../src/commands/update.js";
import { canonicalSource } from "../../src/core/deps.js";
import { diffManifestLockfile } from "../../src/core/lockfile.js";
import type { Dependency, Lockfile } from "../../src/types.js";
import { addTagToRepo, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string | undefined;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
	tempDir = undefined;
});

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

/**
 * `other` at `*` written as `file://…/upstream.git`, `stable` at `^0.4.0`
 * written with a trailing slash. Upstream has v0.4.0 and v0.6.0.
 */
async function respelledProject(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "skilltree-respelled-"));
	tempDir = dir;
	const skills = [
		{ path: "skills/stable", name: "stable" },
		{ path: "skills/other", name: "other" },
	];
	const repoDir = await createTestRepo(dir, "upstream", skills, "v0.4.0");
	const bareDir = join(dir, "upstream.git");
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	await addTagToRepo(repoDir, bareDir, "v0.6.0", skills);

	const projectDir = join(dir, "project");
	await mkdir(projectDir, { recursive: true });
	await writeFile(
		join(projectDir, "skilltree.yml"),
		`dependencies:
  other:
    repo: "file://${bareDir}"
    path: skills/other
    type: skill
    version: "*"
  stable:
    repo: "file://${bareDir}/"
    path: skills/stable
    type: skill
    version: "^0.4.0"
`,
	);
	await installCommand(projectDir, {});
	return projectDir;
}

describe("repo spellings outside the resolver (#203)", () => {
	test("RC1 a respelled repo URL doesn't make the lockfile stale", () => {
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				stable: {
					type: "skill",
					group: "prod",
					repo: "github.com/elastic/agent-skills",
					path: "skills/stable",
					version: "0.4.0",
					commit: "d".repeat(40),
					dependencies: [],
				},
			},
		};

		const diff = diffManifestLockfile(
			{
				dependencies: {
					stable: {
						repo: "https://github.com/elastic/agent-skills.git",
						path: "skills/stable",
					},
				},
			},
			lockfile,
		);

		expect(diff.unchanged).toContain("stable");
	});

	test("RC2 outdated attributes a cap to a sibling spelled differently", async () => {
		const projectDir = await respelledProject();

		const output = await captureLogs(() => outdatedCommand(projectDir, undefined, { json: true }));
		const other = (JSON.parse(output) as OutdatedRow[]).find((r) => r.name === "other");

		expect(other?.current).toBe("0.4.0");
		expect(other?.cappedBy).toEqual(["stable@^0.4.0"]);
	});

	test("RC3 update <name> clears same-repo siblings spelled differently", async () => {
		const projectDir = await respelledProject();

		const output = await captureLogs(() => updateCommand(projectDir, "stable"));

		expect(output).toContain("Cleared 2 lockfile entries");
	});

	test.each([
		["github.com/elastic/agent-skills", "https://github.com/elastic/agent-skills.git"],
		["git@github.com:elastic/agent-skills", "github.com/elastic/agent-skills/"],
	])("RC4 canonicalSource(%p) equals canonicalSource(%p)", (left, right) => {
		const dep = (repo: string) => ({ repo, path: "skills/stable" }) as Dependency;

		expect(canonicalSource(dep(left))).toBe(canonicalSource(dep(right)));
	});
});
