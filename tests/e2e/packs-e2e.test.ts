import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { installCommand } from "../../src/commands/install.js";
import { parseLockfile } from "../../src/core/lockfile.js";
import { createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function writeManifest(dir: string, content: string): Promise<void> {
	await writeFile(join(dir, "skilltree.yml"), content, "utf-8");
}

async function makeBareClone(repoDir: string, baseDir: string, name: string): Promise<string> {
	const bareDir = join(baseDir, `${name}.git`);
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	return bareDir;
}

describe("e2e packs", () => {
	test("local pack: install expands and materializes all members", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-e2e-packs-local-"));

		// One remote repo with the three member skills.
		const repoDir = await createTestRepo(
			tempDir,
			"skills-repo",
			[
				{ path: "skills/foo", name: "foo" },
				{ path: "skills/bar", name: "bar" },
				{ path: "skills/baz", name: "baz" },
			],
			"v1.0.0",
		);
		const bareDir = await makeBareClone(repoDir, tempDir, "skills-bare");

		// Local pack defined in the consumer manifest, references the bare clone.
		await writeManifest(
			tempDir,
			[
				"packs:",
				"  python-pack:",
				`    - repo: file://${bareDir}`,
				"      path: skills/foo",
				"      version: ^1.0.0",
				`    - repo: file://${bareDir}`,
				"      path: skills/bar",
				"      version: ^1.0.0",
				`    - repo: file://${bareDir}`,
				"      path: skills/baz",
				"      version: ^1.0.0",
				"dependencies:",
				"  python-pack:",
				"    pack: python-pack",
				"",
			].join("\n"),
		);

		await installCommand(tempDir, {});

		// All three member skills are materialized in .claude/skills/
		for (const name of ["foo", "bar", "baz"]) {
			const skillDir = join(tempDir, ".claude", "skills", name);
			const s = await lstat(skillDir);
			expect(s.isDirectory()).toBe(true);
			const skillMd = await readFile(join(skillDir, "SKILL.md"), "utf-8");
			expect(skillMd).toContain(name);
		}

		// Lockfile contains the expanded members but NOT the pack itself.
		const lock = parseLockfile(await readFile(join(tempDir, "skilltree.lock"), "utf-8"));
		expect(lock.packages.foo).toBeDefined();
		expect(lock.packages.bar).toBeDefined();
		expect(lock.packages.baz).toBeDefined();
		expect(lock.packages["python-pack"]).toBeUndefined();
	});

	test("remote pack: install reads pack from origin manifest and installs members", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-e2e-packs-remote-"));

		// Member skills live in repo B.
		const repoB = await createTestRepo(
			tempDir,
			"members-repo",
			[
				{ path: "skills/foo", name: "foo" },
				{ path: "skills/bar", name: "bar" },
			],
			"v1.0.0",
		);
		const bareB = await makeBareClone(repoB, tempDir, "members-bare");

		// Pack-host repo defines `packs:` pointing at repo B.
		const packHostManifest = [
			"name: pack-host",
			"packs:",
			"  python-pack:",
			`    - repo: file://${bareB}`,
			"      path: skills/foo",
			"      version: ^1.0.0",
			`    - repo: file://${bareB}`,
			"      path: skills/bar",
			"      version: ^1.0.0",
		].join("\n");
		const repoA = await createTestRepo(tempDir, "pack-host", [], "v1.0.0", packHostManifest);
		const bareA = await makeBareClone(repoA, tempDir, "pack-host-bare");

		// Consumer references the remote pack.
		await writeManifest(
			tempDir,
			[
				"dependencies:",
				"  python-pack:",
				"    pack: python-pack",
				`    repo: file://${bareA}`,
				"    version: ^1.0.0",
				"",
			].join("\n"),
		);

		await installCommand(tempDir, {});

		for (const name of ["foo", "bar"]) {
			const skillDir = join(tempDir, ".claude", "skills", name);
			const s = await lstat(skillDir);
			expect(s.isDirectory()).toBe(true);
		}

		const lock = parseLockfile(await readFile(join(tempDir, "skilltree.lock"), "utf-8"));
		expect(lock.packages.foo).toBeDefined();
		expect(lock.packages.bar).toBeDefined();
		expect(lock.packages["python-pack"]).toBeUndefined();
	});
});
