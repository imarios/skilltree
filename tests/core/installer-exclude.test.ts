import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { ResolvedEntity } from "../../src/core/graph.js";
import { executeInstall } from "../../src/core/installer.js";
import { createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-installer-exclude-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function writeSkill(projectDir: string, name: string, files: Record<string, string>) {
	const skillDir = join(projectDir, "skills", name);
	await mkdir(skillDir, { recursive: true });
	for (const [rel, content] of Object.entries(files)) {
		const full = join(skillDir, rel);
		await mkdir(join(full, ".."), { recursive: true });
		await writeFile(full, content, "utf-8");
	}
}

function makeEntity(name: string, opts: { exclude?: string[] } = {}): ResolvedEntity {
	const e: ResolvedEntity = {
		key: name,
		name,
		type: "skill",
		group: "prod",
		path: `./skills/${name}`,
		commit: "HEAD",
		local: true,
		dependencies: [],
	};
	if (opts.exclude) e.exclude = opts.exclude;
	return e;
}

describe("installer — exclude + .skilltreeignore (Carbon Phase 3)", () => {
	test("per-entity exclude drops matched files from the copy", async () => {
		const dir = await makeTempDir();
		await writeSkill(dir, "foo", {
			"SKILL.md": "---\nname: foo\n---\n# Foo\n",
			"experiments/a.md": "scratch a\n",
			"experiments/b.md": "scratch b\n",
			"keep.md": "keep this\n",
		});
		const entity = makeEntity("foo", { exclude: ["experiments/"] });
		const plan = {
			toInstall: [{ entity, action: "copy" as const, targetPath: join(dir, ".claude/skills/foo") }],
			skipped: [],
			warnings: [],
		};
		await executeInstall(plan, dir, { installPath: join(dir, ".claude"), force: true });

		expect(existsSync(join(dir, ".claude/skills/foo/SKILL.md"))).toBe(true);
		expect(existsSync(join(dir, ".claude/skills/foo/keep.md"))).toBe(true);
		expect(existsSync(join(dir, ".claude/skills/foo/experiments"))).toBe(false);
	});

	test("per-entity exclude glob matches files anywhere in the entity tree", async () => {
		const dir = await makeTempDir();
		await writeSkill(dir, "foo", {
			"SKILL.md": "---\nname: foo\n---\n# Foo\n",
			"notes.scratch.md": "scratch\n",
			"sub/deep.scratch.md": "scratch deep\n",
			"keep.md": "keep\n",
		});
		const entity = makeEntity("foo", { exclude: ["*.scratch.md"] });
		const plan = {
			toInstall: [{ entity, action: "copy" as const, targetPath: join(dir, ".claude/skills/foo") }],
			skipped: [],
			warnings: [],
		};
		await executeInstall(plan, dir, { installPath: join(dir, ".claude"), force: true });

		expect(existsSync(join(dir, ".claude/skills/foo/notes.scratch.md"))).toBe(false);
		expect(existsSync(join(dir, ".claude/skills/foo/sub/deep.scratch.md"))).toBe(false);
		expect(existsSync(join(dir, ".claude/skills/foo/keep.md"))).toBe(true);
	});

	test(".skilltreeignore at repo root applies to every local entity copy", async () => {
		const dir = await makeTempDir();
		await writeSkill(dir, "foo", {
			"SKILL.md": "---\nname: foo\n---\n# Foo\n",
			"experiments/x.md": "x\n",
			"keep.md": "k\n",
		});
		await writeFile(join(dir, ".skilltreeignore"), "experiments/\n", "utf-8");

		const entity = makeEntity("foo"); // no per-entity exclude
		const plan = {
			toInstall: [{ entity, action: "copy" as const, targetPath: join(dir, ".claude/skills/foo") }],
			skipped: [],
			warnings: [],
		};
		await executeInstall(plan, dir, { installPath: join(dir, ".claude"), force: true });

		expect(existsSync(join(dir, ".claude/skills/foo/SKILL.md"))).toBe(true);
		expect(existsSync(join(dir, ".claude/skills/foo/keep.md"))).toBe(true);
		expect(existsSync(join(dir, ".claude/skills/foo/experiments"))).toBe(false);
	});

	test("layered: exclude + .skilltreeignore — union of patterns", async () => {
		const dir = await makeTempDir();
		await writeSkill(dir, "foo", {
			"SKILL.md": "---\nname: foo\n---\n# Foo\n",
			"experiments/x.md": "x\n",
			"ab-results/y.md": "y\n",
			"keep.md": "k\n",
		});
		await writeFile(join(dir, ".skilltreeignore"), "ab-results/\n", "utf-8");

		const entity = makeEntity("foo", { exclude: ["experiments/"] });
		const plan = {
			toInstall: [{ entity, action: "copy" as const, targetPath: join(dir, ".claude/skills/foo") }],
			skipped: [],
			warnings: [],
		};
		await executeInstall(plan, dir, { installPath: join(dir, ".claude"), force: true });

		expect(existsSync(join(dir, ".claude/skills/foo/SKILL.md"))).toBe(true);
		expect(existsSync(join(dir, ".claude/skills/foo/keep.md"))).toBe(true);
		expect(existsSync(join(dir, ".claude/skills/foo/experiments"))).toBe(false);
		expect(existsSync(join(dir, ".claude/skills/foo/ab-results"))).toBe(false);
	});

	test("no exclude, no .skilltreeignore → today's behavior preserved", async () => {
		const dir = await makeTempDir();
		await writeSkill(dir, "foo", {
			"SKILL.md": "---\nname: foo\n---\n# Foo\n",
			"experiments/x.md": "x\n",
		});

		const entity = makeEntity("foo");
		const plan = {
			toInstall: [{ entity, action: "copy" as const, targetPath: join(dir, ".claude/skills/foo") }],
			skipped: [],
			warnings: [],
		};
		await executeInstall(plan, dir, { installPath: join(dir, ".claude"), force: true });

		expect(existsSync(join(dir, ".claude/skills/foo/SKILL.md"))).toBe(true);
		expect(existsSync(join(dir, ".claude/skills/foo/experiments/x.md"))).toBe(true);
	});
});

describe("installer — exclude applied when copying from git cache (issue #139)", () => {
	test("per-entity exclude filters blobs read from the bare repo", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"origin",
			[
				{ path: "skills/foo", name: "foo" },
				{ path: "skills/foo/experiments/a", name: "experiment-a" },
				{ path: "skills/foo/experiments/b", name: "experiment-b" },
				{ path: "skills/foo/docs/raw", name: "docs-raw" },
			],
			"v1.0.0",
		);
		await writeFile(join(repoDir, "skills/foo/keep.md"), "keep\n", "utf-8");
		const git = simpleGit(repoDir);
		await git.add(".");
		await git.commit("Add keep.md");
		await git.tag(["-d", "v1.0.0"]);
		await git.addTag("v1.0.0");

		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const installBase = join(dir, ".claude");
		const targetPath = join(installBase, "skills", "foo");
		const entity: ResolvedEntity = {
			key: "foo",
			name: "foo",
			type: "skill",
			group: "prod",
			repo: "github.com/test/origin",
			path: "skills/foo",
			version: "1.0.0",
			tag: "v1.0.0",
			commit: "deadbeef",
			local: false,
			dependencies: [],
			cachePath: bareDir,
			exclude: ["experiments/", "docs/"],
		};

		const plan = {
			toInstall: [{ entity, action: "copy" as const, targetPath }],
			skipped: [],
			warnings: [],
		};
		await executeInstall(plan, dir, { installPath: installBase, force: true });

		expect(existsSync(join(targetPath, "SKILL.md"))).toBe(true);
		expect(existsSync(join(targetPath, "keep.md"))).toBe(true);
		expect(existsSync(join(targetPath, "experiments"))).toBe(false);
		expect(existsSync(join(targetPath, "docs"))).toBe(false);
	});

	test("no exclude on remote entity → every blob is copied (regression guard)", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"origin",
			[
				{ path: "skills/foo", name: "foo" },
				{ path: "skills/foo/experiments/a", name: "experiment-a" },
			],
			"v1.0.0",
		);
		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const installBase = join(dir, ".claude");
		const targetPath = join(installBase, "skills", "foo");
		const entity: ResolvedEntity = {
			key: "foo",
			name: "foo",
			type: "skill",
			group: "prod",
			repo: "github.com/test/origin",
			path: "skills/foo",
			version: "1.0.0",
			tag: "v1.0.0",
			commit: "deadbeef",
			local: false,
			dependencies: [],
			cachePath: bareDir,
		};

		const plan = {
			toInstall: [{ entity, action: "copy" as const, targetPath }],
			skipped: [],
			warnings: [],
		};
		await executeInstall(plan, dir, { installPath: installBase, force: true });

		expect(existsSync(join(targetPath, "SKILL.md"))).toBe(true);
		expect(existsSync(join(targetPath, "experiments/a/SKILL.md"))).toBe(true);
	});
});

describe("installer — origin's .skilltreeignore applied to remote installs (issue #148)", () => {
	test("origin's .skilltreeignore filters blobs when consumer installs as a remote dep", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"origin",
			[{ path: "skills/foo", name: "foo" }],
			undefined,
		);
		await writeFile(join(repoDir, "skills/foo/keep.md"), "keep\n", "utf-8");
		await writeFile(join(repoDir, "skills/foo/notes.scratch"), "scratch\n", "utf-8");
		await mkdir(join(repoDir, "skills/foo/sub"), { recursive: true });
		await writeFile(join(repoDir, "skills/foo/sub/inner.scratch"), "deep scratch\n", "utf-8");
		await writeFile(join(repoDir, ".skilltreeignore"), "**/*.scratch\n", "utf-8");
		const git = simpleGit(repoDir);
		await git.add(".");
		await git.commit("Add .skilltreeignore and scratch files");
		await git.addTag("v1.0.0");

		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const installBase = join(dir, ".claude");
		const targetPath = join(installBase, "skills", "foo");
		const entity: ResolvedEntity = {
			key: "foo",
			name: "foo",
			type: "skill",
			group: "prod",
			repo: "github.com/test/origin",
			path: "skills/foo",
			version: "1.0.0",
			tag: "v1.0.0",
			commit: "deadbeef",
			local: false,
			dependencies: [],
			cachePath: bareDir,
		};

		const plan = {
			toInstall: [{ entity, action: "copy" as const, targetPath }],
			skipped: [],
			warnings: [],
		};
		await executeInstall(plan, dir, { installPath: installBase, force: true });

		expect(existsSync(join(targetPath, "SKILL.md"))).toBe(true);
		expect(existsSync(join(targetPath, "keep.md"))).toBe(true);
		expect(existsSync(join(targetPath, "notes.scratch"))).toBe(false);
		expect(existsSync(join(targetPath, "sub/inner.scratch"))).toBe(false);
	});

	test("origin's .skilltreeignore layers with per-entity exclude (union of patterns)", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"origin",
			[{ path: "skills/foo", name: "foo" }],
			undefined,
		);
		await writeFile(join(repoDir, "skills/foo/keep.md"), "keep\n", "utf-8");
		await writeFile(join(repoDir, "skills/foo/notes.scratch"), "scratch\n", "utf-8");
		await mkdir(join(repoDir, "skills/foo/experiments"), { recursive: true });
		await writeFile(join(repoDir, "skills/foo/experiments/e.md"), "exp\n", "utf-8");
		await writeFile(join(repoDir, ".skilltreeignore"), "**/*.scratch\n", "utf-8");
		const git = simpleGit(repoDir);
		await git.add(".");
		await git.commit("Add .skilltreeignore + experiments");
		await git.addTag("v1.0.0");

		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const installBase = join(dir, ".claude");
		const targetPath = join(installBase, "skills", "foo");
		const entity: ResolvedEntity = {
			key: "foo",
			name: "foo",
			type: "skill",
			group: "prod",
			repo: "github.com/test/origin",
			path: "skills/foo",
			version: "1.0.0",
			tag: "v1.0.0",
			commit: "deadbeef",
			local: false,
			dependencies: [],
			cachePath: bareDir,
			exclude: ["experiments/"],
		};

		const plan = {
			toInstall: [{ entity, action: "copy" as const, targetPath }],
			skipped: [],
			warnings: [],
		};
		await executeInstall(plan, dir, { installPath: installBase, force: true });

		expect(existsSync(join(targetPath, "SKILL.md"))).toBe(true);
		expect(existsSync(join(targetPath, "keep.md"))).toBe(true);
		expect(existsSync(join(targetPath, "notes.scratch"))).toBe(false);
		expect(existsSync(join(targetPath, "experiments"))).toBe(false);
	});

	test("no .skilltreeignore in origin → every blob still copied (regression guard)", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"origin",
			[{ path: "skills/foo", name: "foo" }],
			"v1.0.0",
		);
		const bareDir = join(dir, "bare");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const installBase = join(dir, ".claude");
		const targetPath = join(installBase, "skills", "foo");
		const entity: ResolvedEntity = {
			key: "foo",
			name: "foo",
			type: "skill",
			group: "prod",
			repo: "github.com/test/origin",
			path: "skills/foo",
			version: "1.0.0",
			tag: "v1.0.0",
			commit: "deadbeef",
			local: false,
			dependencies: [],
			cachePath: bareDir,
		};

		const plan = {
			toInstall: [{ entity, action: "copy" as const, targetPath }],
			skipped: [],
			warnings: [],
		};
		await executeInstall(plan, dir, { installPath: installBase, force: true });

		expect(existsSync(join(targetPath, "SKILL.md"))).toBe(true);
	});
});
