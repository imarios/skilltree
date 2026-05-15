import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedEntity } from "../../src/core/graph.js";
import { executeInstall } from "../../src/core/installer.js";

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
