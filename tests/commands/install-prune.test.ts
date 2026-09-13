import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync } from "node:fs";
import {
	appendFile,
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand } from "../../src/commands/install.js";
import { updateCommand } from "../../src/commands/update.js";
import { writeGlobalManifest } from "../../src/core/manifest.js";
import { createLocalSkill, createTestRepo } from "../helpers/git-fixtures.js";

/**
 * #205: `install` and `update` prune entities that left the manifest.
 *
 * An entity is only removed when both hold:
 *  - the lockfile the run started from says skilltree installed it, and
 *  - what is on disk is still what skilltree put there (a symlink to the
 *    recorded source, or a copy matching the recorded integrity hash).
 * Anything else is kept with a warning; `install --force` removes edited
 * copies. Nothing the previous lockfile didn't list is ever touched.
 */

let tempDir: string;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-prune-"));
	return tempDir;
}

function exists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}

function localManifest(names: string[], extra = ""): string {
	return `${extra}dependencies:\n${names.map((n) => `  ${n}:\n    local: ./skills/${n}\n`).join("")}`;
}

async function remoteRepo(base: string, names: string[]): Promise<string> {
	const repo = await createTestRepo(
		base,
		"remote",
		names.map((n) => ({ path: `skills/${n}`, name: n })),
		"1.0.0",
	);
	return `file://${repo}`;
}

function remoteManifest(url: string, names: string[]): string {
	return `dependencies:\n${names
		.map((n) => `  ${n}:\n    repo: ${url}\n    path: skills/${n}\n    version: "*"\n`)
		.join("")}`;
}

async function capture(fn: () => Promise<void>): Promise<{ log: string; warn: string }> {
	const logs: string[] = [];
	const warns: string[] = [];
	const log = console.log;
	const warn = console.warn;
	console.log = (m?: unknown) => {
		logs.push(String(m));
	};
	console.warn = (m?: unknown) => {
		warns.push(String(m));
	};
	try {
		await fn();
	} finally {
		console.log = log;
		console.warn = warn;
	}
	return { log: logs.join("\n"), warn: warns.join("\n") };
}

describe("install prunes entities removed from the manifest (#205)", () => {
	test("removes a local dep's symlink once it leaves the manifest", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "keep");
		await createLocalSkill(join(dir, "skills"), "gone");
		await writeFile(join(dir, "skilltree.yml"), localManifest(["keep", "gone"]));
		await installCommand(dir, {});
		expect(exists(join(dir, ".claude/skills/gone"))).toBe(true);

		await writeFile(join(dir, "skilltree.yml"), localManifest(["keep"]));
		await capture(() => installCommand(dir, {}));

		expect(exists(join(dir, ".claude/skills/gone"))).toBe(false);
		expect(exists(join(dir, ".claude/skills/keep"))).toBe(true);
		expect(await readFile(join(dir, "skilltree.lock"), "utf-8")).not.toContain("gone");
		// Pruning removes the link, never the source it points at.
		expect(exists(join(dir, "skills/gone/SKILL.md"))).toBe(true);
	});

	test("removes an unmodified remote copy", async () => {
		const dir = await makeTempDir();
		const url = await remoteRepo(dir, ["foo", "bar"]);
		await writeFile(join(dir, "skilltree.yml"), remoteManifest(url, ["foo", "bar"]));
		await installCommand(dir, {});
		expect(exists(join(dir, ".claude/skills/bar"))).toBe(true);

		await writeFile(join(dir, "skilltree.yml"), remoteManifest(url, ["foo"]));
		await capture(() => installCommand(dir, {}));

		expect(exists(join(dir, ".claude/skills/bar"))).toBe(false);
		expect(exists(join(dir, ".claude/skills/foo"))).toBe(true);
	});

	test("keeps a remote copy with local edits, and says how to remove it", async () => {
		const dir = await makeTempDir();
		const url = await remoteRepo(dir, ["foo", "bar"]);
		await writeFile(join(dir, "skilltree.yml"), remoteManifest(url, ["foo", "bar"]));
		await installCommand(dir, {});
		const edited = join(dir, ".claude/skills/bar/SKILL.md");
		await chmod(edited, 0o644);
		await appendFile(edited, "\nmy local notes\n");

		await writeFile(join(dir, "skilltree.yml"), remoteManifest(url, ["foo"]));
		const out = await capture(() => installCommand(dir, {}));

		expect(exists(join(dir, ".claude/skills/bar"))).toBe(true);
		expect(out.warn).toContain("bar");
		expect(out.warn).toContain("--force");
	});

	test("install --force removes an edited orphan", async () => {
		const dir = await makeTempDir();
		const url = await remoteRepo(dir, ["foo", "bar"]);
		await writeFile(join(dir, "skilltree.yml"), remoteManifest(url, ["foo", "bar"]));
		await installCommand(dir, {});
		const edited = join(dir, ".claude/skills/bar/SKILL.md");
		await chmod(edited, 0o644);
		await appendFile(edited, "\nmy local notes\n");

		await writeFile(join(dir, "skilltree.yml"), remoteManifest(url, ["foo"]));
		await capture(() => installCommand(dir, { force: true }));

		expect(exists(join(dir, ".claude/skills/bar"))).toBe(false);
	});

	test("never touches a directory the previous lockfile didn't list", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "keep");
		await createLocalSkill(join(dir, "skills"), "gone");
		await writeFile(join(dir, "skilltree.yml"), localManifest(["keep", "gone"]));
		await installCommand(dir, {});
		const handPlaced = join(dir, ".claude/skills/hand-placed");
		await mkdir(handPlaced, { recursive: true });
		await writeFile(join(handPlaced, "SKILL.md"), "---\nname: hand-placed\n---\n");

		await writeFile(join(dir, "skilltree.yml"), localManifest(["keep"]));
		await capture(() => installCommand(dir, {}));

		expect(exists(handPlaced)).toBe(true);
		expect(exists(join(dir, ".claude/skills/gone"))).toBe(false);
	});

	test("keeps a symlink that now points somewhere else", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "keep");
		await createLocalSkill(join(dir, "skills"), "gone");
		await writeFile(join(dir, "skilltree.yml"), localManifest(["keep", "gone"]));
		await installCommand(dir, {});
		// The user replaced skilltree's link with one of their own.
		const theirs = await createLocalSkill(join(dir, "elsewhere"), "gone");
		await rm(join(dir, ".claude/skills/gone"));
		await symlink(theirs, join(dir, ".claude/skills/gone"));

		await writeFile(join(dir, "skilltree.yml"), localManifest(["keep"]));
		const out = await capture(() => installCommand(dir, {}));

		expect(exists(join(dir, ".claude/skills/gone"))).toBe(true);
		expect(out.warn).toContain("gone");
	});

	test("renaming an alias does not delete the entity it just installed", async () => {
		const dir = await makeTempDir();
		const url = await remoteRepo(dir, ["bar"]);
		await writeFile(
			join(dir, "skilltree.yml"),
			`dependencies:\n  bar:\n    repo: ${url}\n    path: skills/bar\n    version: "*"\n`,
		);
		await installCommand(dir, {});

		// Same entity, new manifest key: the old key leaves the lockfile, but
		// the new entry installs to the same `skills/bar`.
		await writeFile(
			join(dir, "skilltree.yml"),
			`dependencies:\n  my-bar:\n    repo: ${url}\n    path: skills/bar\n    version: "*"\n    name: bar\n`,
		);
		await capture(() => installCommand(dir, {}));

		expect(exists(join(dir, ".claude/skills/bar"))).toBe(true);
	});

	test("--dry-run lists what it would remove and deletes nothing", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "keep");
		await createLocalSkill(join(dir, "skills"), "gone");
		await writeFile(join(dir, "skilltree.yml"), localManifest(["keep", "gone"]));
		await installCommand(dir, {});

		await writeFile(join(dir, "skilltree.yml"), localManifest(["keep"]));
		const out = await capture(() => installCommand(dir, { dryRun: true }));

		expect(exists(join(dir, ".claude/skills/gone"))).toBe(true);
		expect(out.log).toMatch(/would remove[^\n]*gone/i);
	});

	test("prunes from every install target", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "keep");
		await createLocalSkill(join(dir, "skills"), "gone");
		const targets = "install_targets:\n  - claude\n  - cursor\n";
		await writeFile(join(dir, "skilltree.yml"), localManifest(["keep", "gone"], targets));
		await installCommand(dir, {});
		expect(exists(join(dir, ".cursor/skills/gone"))).toBe(true);

		await writeFile(join(dir, "skilltree.yml"), localManifest(["keep"], targets));
		await capture(() => installCommand(dir, {}));

		expect(exists(join(dir, ".claude/skills/gone"))).toBe(false);
		expect(exists(join(dir, ".cursor/skills/gone"))).toBe(false);
	});

	test("with no previous lockfile there is no record, so nothing is pruned", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "keep");
		const leftover = join(dir, ".claude/skills/leftover");
		await mkdir(leftover, { recursive: true });
		await writeFile(join(leftover, "SKILL.md"), "---\nname: leftover\n---\n");

		await writeFile(join(dir, "skilltree.yml"), localManifest(["keep"]));
		await capture(() => installCommand(dir, {}));

		expect(exists(leftover)).toBe(true);
	});

	test("global install prunes too", async () => {
		const dir = await makeTempDir();
		const globalDir = join(dir, "global");
		const suffix = Math.random().toString(36).slice(2, 8);
		const keep = `gkeep-${suffix}`;
		const gone = `ggone-${suffix}`;
		const keepSrc = await createLocalSkill(join(dir, "skills"), keep);
		const goneSrc = await createLocalSkill(join(dir, "skills"), gone);
		await writeGlobalManifest(
			{ dependencies: { [keep]: { local: keepSrc }, [gone]: { local: goneSrc } } },
			globalDir,
		);
		await installCommand("", { global: true, globalDir });
		// Sandboxed $HOME (tests/setup/sandbox-home.ts), never the real one.
		const installed = join(process.env.HOME ?? "", ".claude/skills", gone);
		expect(exists(installed)).toBe(true);

		await writeGlobalManifest({ dependencies: { [keep]: { local: keepSrc } } }, globalDir);
		await capture(() => installCommand("", { global: true, globalDir }));

		expect(exists(installed)).toBe(false);
		expect(exists(join(process.env.HOME ?? "", ".claude/skills", keep))).toBe(true);
		expect(exists(join(goneSrc, "SKILL.md"))).toBe(true);
	});
});

describe("update prunes against the lockfile it started from (#205)", () => {
	test("update removes a dep dropped from the manifest", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "keep");
		await createLocalSkill(join(dir, "skills"), "gone");
		await writeFile(join(dir, "skilltree.yml"), localManifest(["keep", "gone"]));
		await installCommand(dir, {});

		await writeFile(join(dir, "skilltree.yml"), localManifest(["keep"]));
		await capture(() => updateCommand(dir, undefined, {}));

		expect(exists(join(dir, ".claude/skills/gone"))).toBe(false);
		expect(existsSync(join(dir, ".claude/skills/keep"))).toBe(true);
	});

	test("update <name> also prunes deps dropped from the manifest", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "keep");
		await createLocalSkill(join(dir, "skills"), "gone");
		await writeFile(join(dir, "skilltree.yml"), localManifest(["keep", "gone"]));
		await installCommand(dir, {});

		await writeFile(join(dir, "skilltree.yml"), localManifest(["keep"]));
		await capture(() => updateCommand(dir, "keep", {}));

		expect(exists(join(dir, ".claude/skills/gone"))).toBe(false);
	});

	test("update keeps an edited orphan even though it installs with force", async () => {
		const dir = await makeTempDir();
		const url = await remoteRepo(dir, ["foo", "bar"]);
		await writeFile(join(dir, "skilltree.yml"), remoteManifest(url, ["foo", "bar"]));
		await installCommand(dir, {});
		const edited = join(dir, ".claude/skills/bar/SKILL.md");
		await chmod(edited, 0o644);
		await appendFile(edited, "\nmy local notes\n");

		await writeFile(join(dir, "skilltree.yml"), remoteManifest(url, ["foo"]));
		const out = await capture(() => updateCommand(dir, undefined, {}));

		expect(exists(join(dir, ".claude/skills/bar"))).toBe(true);
		expect(out.warn).toContain("bar");
	});
});
