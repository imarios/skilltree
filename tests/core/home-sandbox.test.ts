import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { expandTilde, getGlobalDir, getGlobalInstallBase } from "../../src/core/paths.js";

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
});
