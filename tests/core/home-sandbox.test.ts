import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { getCacheDir, repoCachePath } from "../../src/core/git.js";
import { expandTilde, getGlobalDir, getGlobalInstallBase } from "../../src/core/paths.js";
import {
	getRegistryCacheDir,
	getRegistryIndexPath,
	getRegistryRepoDir,
} from "../../src/core/registry-cache.js";
import { getConfigDir, getConfigPath } from "../../src/core/registry-config.js";

/**
 * The test suite must never write into the developer's real home directory.
 *
 * `install --global` resolves its targets through `expandTilde("~/.claude")`,
 * which used `os.homedir()` unconditionally — so every test that reached the
 * global install path wrote into the real `~/.claude/skills/`, overwriting
 * whatever `skilltree teach` had put there and leaving symlinks into deleted
 * temp directories behind.
 *
 * Bun resolves `os.homedir()` once at process start and ignores later
 * mutation of `process.env.HOME`, so the sandbox only works if these helpers
 * consult `$HOME` themselves — which is what Node's own `os.homedir()` does
 * on POSIX, and what `resolveShellHome` in `completion.ts` already did.
 */
describe("home directory sandbox", () => {
	test("$HOME is redirected away from the real home during tests", () => {
		expect(process.env.HOME).toBeDefined();
		expect(process.env.HOME).not.toBe(homedir());
	});

	test("expandTilde follows $HOME", () => {
		const sandboxHome = process.env.HOME ?? "";
		expect(sandboxHome).not.toBe("");
		expect(expandTilde("~/x")).toBe(`${sandboxHome}/x`);
		expect(expandTilde("~")).toBe(sandboxHome);
	});

	test("global paths resolve inside the sandbox, not the real home", () => {
		const real = homedir();
		expect(getGlobalDir().startsWith(real)).toBe(false);
		expect(getGlobalInstallBase().startsWith(real)).toBe(false);
	});

	// These used to be module-load constants built from `os.homedir()`, so
	// every test that cloned a repo wrote bare clones into the real
	// `~/.skilltree/cache` (e.g. `~/.skilltree/cache/file:/private/...`).
	test("persistent ~/.skilltree paths resolve under $HOME, not the real home", () => {
		const sandboxHome = process.env.HOME ?? "";
		const paths = [
			getCacheDir(),
			repoCachePath("github.com/user/repo"),
			getRegistryCacheDir(),
			getRegistryRepoDir("vibes"),
			getRegistryIndexPath("vibes"),
			getConfigDir(),
			getConfigPath(),
		];
		for (const p of paths) {
			expect(p.startsWith(`${sandboxHome}/.skilltree`)).toBe(true);
		}
	});

	test("~/.skilltree paths follow $HOME changes made after module load", () => {
		const original = process.env.HOME;
		process.env.HOME = "/tmp/skilltree-later-home";
		try {
			expect(getCacheDir()).toBe(join("/tmp/skilltree-later-home", ".skilltree", "cache"));
			expect(getRegistryCacheDir()).toBe(
				join("/tmp/skilltree-later-home", ".skilltree", "registry-cache"),
			);
			expect(getConfigPath()).toBe(join("/tmp/skilltree-later-home", ".skilltree", "config.yaml"));
		} finally {
			process.env.HOME = original;
		}
	});
});
