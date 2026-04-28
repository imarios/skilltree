import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { teachCommand } from "../../src/commands/teach.js";
import { readGlobalLockfile } from "../../src/core/lockfile.js";
import { readGlobalManifest } from "../../src/core/manifest.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(tmpdir(), `skilltree-teach-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	await mkdir(join(tempDir, "home", ".claude"), { recursive: true });
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("teachCommand", () => {
	test("adds skilltree skill to global manifest", async () => {
		const dir = await setup();
		const globalDir = join(dir, "global-config");
		await teachCommand({ homeDir: join(dir, "home"), globalDir });

		const manifest = await readGlobalManifest(globalDir);
		expect(manifest.dependencies?.skilltree).toBeDefined();
		const dep = manifest.dependencies?.skilltree as { local?: string };
		expect(dep.local).toContain("skills/skilltree");
	});

	test("creates lockfile with skilltree entry", async () => {
		const dir = await setup();
		const globalDir = join(dir, "global-config");
		await teachCommand({ homeDir: join(dir, "home"), globalDir });

		const lockfile = await readGlobalLockfile(globalDir);
		expect(lockfile).not.toBeNull();
		expect(lockfile?.packages?.skilltree).toBeDefined();
		expect(lockfile?.packages?.skilltree?.type).toBe("skill");
	});

	test("prints completion hint in output", async () => {
		const dir = await setup();
		const globalDir = join(dir, "global-config");

		const logs: string[] = [];
		const orig = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await teachCommand({ homeDir: join(dir, "home"), globalDir });
		} finally {
			console.log = orig;
		}

		const output = logs.join("\n");
		expect(output).toContain("completion");
		expect(output).toContain("zsh");
	});

	test("overwrites existing skill on re-run", async () => {
		const dir = await setup();
		const globalDir = join(dir, "global-config");
		await teachCommand({ homeDir: join(dir, "home"), globalDir });
		await teachCommand({ homeDir: join(dir, "home"), globalDir });

		const manifest = await readGlobalManifest(globalDir);
		expect(manifest.dependencies?.skilltree).toBeDefined();
	});

	// Regression: when skilltree is run as a compiled binary (not from a
	// checkout of this repo), the dev-mode lookup for `skills/skilltree/`
	// fails. Teach must materialize the skill files embedded in the binary
	// rather than refusing to run or silently depending on `process.cwd()`
	// containing the right files. We simulate the compiled-binary case by
	// pointing `_devSourceDir` at a path that doesn't exist.
	test("falls back to embedded bundle when dev source is missing (compiled-binary case)", async () => {
		const dir = await setup();
		const globalDir = join(dir, "global-config");
		const fakeDevDir = join(dir, "no-such-dev-source");

		await teachCommand({
			homeDir: join(dir, "home"),
			globalDir,
			_devSourceDir: fakeDevDir,
		});

		// Bundled files should have been materialized into globalDir/bundled/skilltree
		const bundledRoot = join(globalDir, "bundled", "skilltree");
		const skillContent = await readFile(join(bundledRoot, "SKILL.md"), "utf-8");
		expect(skillContent).toContain("name: skilltree");
		await stat(join(bundledRoot, "references", "commands.md"));
		await stat(join(bundledRoot, "references", "workflows.md"));

		// Manifest should record the materialized location as the local source
		const manifest = await readGlobalManifest(globalDir);
		const dep = manifest.dependencies?.skilltree as { local?: string };
		expect(dep.local).toBeDefined();
		expect(dep.local).toContain(join("bundled", "skilltree"));

		// Lockfile should be populated as for any normal local skill
		const lockfile = await readGlobalLockfile(globalDir);
		expect(lockfile?.packages?.skilltree?.type).toBe("skill");
	});
});
