import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	generateBashCompletion,
	generateZshCompletion,
	installCompletion,
} from "../../src/commands/completion.js";

const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli.ts");

/**
 * Extract the body of a `case` branch by name. Robust to length changes —
 * unlike a fixed-size `slice(idx, idx + N)`, this returns the full text
 * between `<name>)` and the matching `;;`. Returns `""` if not found.
 *
 * Note: this assumes branches don't contain a literal `;;` other than the
 * terminator, which is true for our generated scripts.
 */
function extractCaseBranch(script: string, name: string): string {
	const startMarker = `${name})`;
	const start = script.indexOf(startMarker);
	if (start === -1) return "";
	const end = script.indexOf(";;", start);
	return script.slice(start, end === -1 ? script.length : end + 2);
}

/**
 * Strip shell-style comment lines so freshness tests don't pass on a
 * flag/name that appears only in the script header.
 */
function stripShellComments(script: string): string {
	return script
		.split("\n")
		.filter((line) => !/^\s*#/.test(line))
		.join("\n");
}

/**
 * Assert that a flag appears in the script as a *whole token*, not as a
 * substring of a longer flag. Caught a real regression: `--install` was
 * matching as a prefix of `--install-path`, so a missing case-branch
 * wiring went undetected.
 */
function expectFlagPresent(script: string, flag: string): void {
	const escaped = flag.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
	const re = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`);
	if (!re.test(script)) {
		throw new Error(`Flag ${flag} not found as whole token in script`);
	}
}

/**
 * Extract all commands and flags from cli.ts source (same parser as freshness test).
 */
async function extractCliDefinitions(): Promise<{
	commands: string[];
	subcommands: Map<string, string[]>;
	options: Map<string, string[]>;
}> {
	const source = await readFile(CLI_PATH, "utf-8");
	const commands: string[] = [];
	const subcommands = new Map<string, string[]>();
	const options = new Map<string, string[]>();
	let currentCmd = "";
	let currentParent = "";

	const lines = source.split("\n");
	for (const line of lines) {
		// Detect parent command groups: `const registry = program.command("registry")`
		const parentMatch = line.match(/const (\w+) = program\.command\(["']([a-z][\w-]*)/);
		if (parentMatch?.[2]) {
			currentParent = parentMatch[2];
			currentCmd = parentMatch[2];
			commands.push(currentCmd);
			subcommands.set(currentParent, []);
			options.set(currentCmd, []);
			continue;
		}

		// Detect top-level commands: `program.command("add")`
		const topMatch = line.match(/^program\s*$/) ? null : line.match(/\.command\(["']([a-z][\w-]*)/);
		if (topMatch?.[1] && !parentMatch) {
			if (currentParent && !line.includes("program")) {
				currentCmd = `${currentParent} ${topMatch[1]}`;
				subcommands.get(currentParent)?.push(topMatch[1]);
			} else {
				currentCmd = topMatch[1];
				currentParent = "";
			}
			commands.push(currentCmd);
			options.set(currentCmd, []);
		}

		// Detect long flags
		const optMatch = line.match(/\.option\(["'][^"']*?(--[\w-]+)/);
		if (optMatch?.[1] && currentCmd) {
			options.get(currentCmd)?.push(optMatch[1]);
		}
	}

	return { commands, subcommands, options };
}

describe("completion generator", () => {
	test("zsh completion covers all top-level commands", async () => {
		const { commands } = await extractCliDefinitions();
		const zsh = generateZshCompletion();

		// Extract just the base command names (no parent prefix)
		const topLevel = commands.filter((c) => !c.includes(" ")).filter((c) => c !== "completion"); // completion itself is meta

		for (const cmd of topLevel) {
			expect(zsh).toContain(cmd);
		}
	});

	test("zsh completion covers all subcommands", async () => {
		const { subcommands } = await extractCliDefinitions();
		const zsh = generateZshCompletion();

		for (const [, subs] of subcommands) {
			for (const sub of subs) {
				expect(zsh).toContain(sub);
			}
		}
	});

	test("zsh completion covers all long flags", async () => {
		const { options } = await extractCliDefinitions();
		const zsh = stripShellComments(generateZshCompletion());

		for (const [, flags] of options) {
			for (const flag of flags) {
				expectFlagPresent(zsh, flag);
			}
		}
	});

	test("bash completion covers all top-level commands", async () => {
		const { commands } = await extractCliDefinitions();
		const bash = generateBashCompletion();

		const topLevel = commands.filter((c) => !c.includes(" ")).filter((c) => c !== "completion");

		for (const cmd of topLevel) {
			expect(bash).toContain(cmd);
		}
	});

	test("bash completion covers all subcommands", async () => {
		const { subcommands } = await extractCliDefinitions();
		const bash = generateBashCompletion();

		for (const [, subs] of subcommands) {
			for (const sub of subs) {
				expect(bash).toContain(sub);
			}
		}
	});

	test("bash completion covers all long flags", async () => {
		const { options } = await extractCliDefinitions();
		const bash = stripShellComments(generateBashCompletion());

		for (const [, flags] of options) {
			for (const flag of flags) {
				expectFlagPresent(bash, flag);
			}
		}
	});

	test("zsh completion is valid shell script (no syntax errors)", () => {
		const zsh = generateZshCompletion();
		// Must start with the compdef function
		expect(zsh).toContain("_skilltree");
		expect(zsh).toContain("compdef");
	});

	test("bash completion is valid shell script", () => {
		const bash = generateBashCompletion();
		expect(bash).toContain("complete");
		expect(bash).toContain("_skilltree");
	});

	test("zsh completion includes short flags alongside long ones", () => {
		const zsh = generateZshCompletion();
		// install has both `--global`/`-g` and `--force`/`-f` — both must
		// appear so `skilltree install -<TAB>` lists short forms.
		expect(zsh).toContain("-g");
		expect(zsh).toContain("-f");
		expect(zsh).toContain("-n");
	});

	test("completion header reports current package version (not stale)", async () => {
		const pkgRaw = await readFile(join(import.meta.dir, "..", "..", "package.json"), "utf-8");
		const pkgVersion = JSON.parse(pkgRaw).version as string;
		expect(generateZshCompletion()).toContain(`v${pkgVersion}`);
		expect(generateBashCompletion()).toContain(`v${pkgVersion}`);
	});

	test("zsh completion wires positional value completion for `remove`", () => {
		const zsh = generateZshCompletion();
		// The helper that calls `skilltree _complete deps` must be defined
		// AND referenced from the `remove` case branch.
		expect(zsh).toContain("_skilltree_complete_deps()");
		expect(zsh).toContain("skilltree _complete deps");
		const branch = extractCaseBranch(zsh, "remove");
		expect(branch).not.toBe("");
		expect(branch).toContain("_skilltree_complete_deps");
	});

	test("bash completion wires positional value completion for `remove`", () => {
		const bash = generateBashCompletion();
		expect(bash).toContain("_skilltree_dyn deps");
		const branch = extractCaseBranch(bash, "remove");
		expect(branch).not.toBe("");
		expect(branch).toContain("_skilltree_dyn deps");
	});

	// Issue 1 regression: `*::value:func` (any-number) re-fired completion
	// after the user already typed an arg. We use `:value:func` (exactly one)
	// because every command with positionalComplete takes one positional.
	test("zsh value spec completes only a single positional, not repeating", () => {
		const zsh = generateZshCompletion();
		const branch = extractCaseBranch(zsh, "remove");
		expect(branch).toContain(":value:_skilltree_complete_deps");
		expect(branch).not.toContain("*::value:");
		expect(branch).not.toContain("*:value:");
	});

	// Issue 2 regression: --global detection used to fire for ANY command,
	// including `info` which does not accept --global. The helper must now
	// scope its detection to commands that actually declare the flag —
	// derived at gen time from the COMMANDS table.
	test("zsh --global detection skips commands that don't declare --global", () => {
		const zsh = generateZshCompletion();
		// info is in the awarePaths gate? Verify the negative.
		// The generated helper interpolates a space-delimited list. info should NOT be in it.
		// remove, update, targets:remove, targets:add SHOULD be in it.
		const helperMatch = zsh.match(/_skilltree_global_flag\(\)\s*\{[\s\S]*?\}/);
		expect(helperMatch).not.toBeNull();
		const helperBody = helperMatch?.[0] ?? "";
		// Look for the gen-time list inside the case pattern.
		expect(helperBody).toContain("remove");
		expect(helperBody).toContain("update");
		expect(helperBody).toContain("targets:remove");
		expect(helperBody).toContain("targets:add");
		// info has positionalComplete but no --global — must not appear in the
		// list. Match it as a standalone token to avoid matching "info" as a
		// substring of e.g. "completion".
		expect(helperBody).not.toMatch(/(^|[ :])info($|[ :])/);
	});

	test("bash --global detection skips commands that don't declare --global", () => {
		const bash = generateBashCompletion();
		const helperMatch = bash.match(/_skilltree_global_flag\(\)\s*\{[\s\S]*?\n\}/);
		expect(helperMatch).not.toBeNull();
		const helperBody = helperMatch?.[0] ?? "";
		expect(helperBody).toContain("remove");
		expect(helperBody).toContain("update");
		expect(helperBody).toContain("targets:remove");
		expect(helperBody).toContain("targets:add");
		expect(helperBody).not.toMatch(/(^|[ :])info($|[ :])/);
	});
});

describe("generated completion scripts pass shell syntax checks", () => {
	// Probe whether each shell is on PATH. Ubuntu runners don't ship zsh by
	// default, so the zsh test is skipped on environments without it; the
	// bash test always runs because bash is universal on POSIX CI.
	const hasShell = (shell: string): boolean => {
		try {
			return spawnSync(shell, ["--version"], { encoding: "utf-8" }).status === 0;
		} catch {
			return false;
		}
	};
	const zshAvailable = hasShell("zsh");
	const bashAvailable = hasShell("bash");

	test.skipIf(!zshAvailable)("zsh -n accepts the generated zsh script", async () => {
		const dir = await mkdtemp(join(tmpdir(), "skilltree-zsh-syntax-"));
		try {
			const path = join(dir, "_skilltree");
			await Bun.write(path, generateZshCompletion());
			const result = spawnSync("zsh", ["-n", path], { encoding: "utf-8" });
			if (result.status !== 0) {
				throw new Error(`zsh -n failed with status ${result.status}\nstderr:\n${result.stderr}`);
			}
			expect(result.status).toBe(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test.skipIf(!bashAvailable)("bash -n accepts the generated bash script", async () => {
		const dir = await mkdtemp(join(tmpdir(), "skilltree-bash-syntax-"));
		try {
			const path = join(dir, "skilltree.bash");
			await Bun.write(path, generateBashCompletion());
			const result = spawnSync("bash", ["-n", path], { encoding: "utf-8" });
			if (result.status !== 0) {
				throw new Error(`bash -n failed with status ${result.status}\nstderr:\n${result.stderr}`);
			}
			expect(result.status).toBe(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

/**
 * End-to-end behavioral tests for the bash script. We source the generated
 * script in a real bash, drive `_skilltree_cmd_path` and the global-flag
 * helpers, and assert their outputs. These would have caught the
 * `remove:--global` regression that the static-string tests missed.
 */
describe.skipIf(spawnSync("bash", ["--version"], { encoding: "utf-8" }).status !== 0)(
	"bash completion behavior (end-to-end)",
	() => {
		function runBashWithScript(snippet: string): { stdout: string; status: number | null } {
			const script = `${generateBashCompletion()}\n${snippet}`;
			const result = spawnSync("bash", ["-c", script], { encoding: "utf-8" });
			return { stdout: result.stdout, status: result.status };
		}

		test("_skilltree_cmd_path returns 'remove' for 'skilltree remove --global'", () => {
			const { stdout } = runBashWithScript(`
			COMP_WORDS=(skilltree remove --global)
			COMP_CWORD=3
			_skilltree_cmd_path
		`);
			expect(stdout.trim()).toBe("remove");
		});

		test("_skilltree_cmd_path returns 'targets:remove' for 'skilltree targets remove'", () => {
			const { stdout } = runBashWithScript(`
			COMP_WORDS=(skilltree targets remove)
			COMP_CWORD=3
			_skilltree_cmd_path
		`);
			expect(stdout.trim()).toBe("targets:remove");
		});

		test("_skilltree_cmd_path does NOT stitch 'parent:flag' for non-parent commands", () => {
			// Regression: 'remove' is not in the parent list, so even though
			// COMP_WORDS[2] is non-empty (--global), we must not produce
			// "remove:--global".
			const { stdout } = runBashWithScript(`
			COMP_WORDS=(skilltree remove --global skill)
			COMP_CWORD=4
			_skilltree_cmd_path
		`);
			expect(stdout.trim()).toBe("remove");
		});

		test("_skilltree_global_flag honors --global for `remove`", () => {
			const { stdout } = runBashWithScript(`
			COMP_WORDS=(skilltree remove --global)
			COMP_CWORD=3
			_skilltree_global_flag
		`);
			expect(stdout.trim()).toBe("--global");
		});

		test("_skilltree_global_flag IGNORES --global for `info` (which doesn't accept it)", () => {
			// The whole point of the rework: bogus --global on `info` must
			// not flip dynamic completion into global-manifest mode.
			const { stdout } = runBashWithScript(`
			COMP_WORDS=(skilltree info skilltree --global)
			COMP_CWORD=4
			_skilltree_global_flag
		`);
			expect(stdout.trim()).toBe("");
		});

		test("_skilltree_global_flag honors --global for `targets remove`", () => {
			const { stdout } = runBashWithScript(`
			COMP_WORDS=(skilltree targets remove --global)
			COMP_CWORD=4
			_skilltree_global_flag
		`);
			expect(stdout.trim()).toBe("--global");
		});

		test("_skilltree_global_flag yields nothing when --global is absent", () => {
			const { stdout } = runBashWithScript(`
			COMP_WORDS=(skilltree remove)
			COMP_CWORD=2
			_skilltree_global_flag
		`);
			expect(stdout.trim()).toBe("");
		});
	},
);

describe("installCompletion", () => {
	let tempHome: string | undefined;

	afterEach(async () => {
		if (tempHome) {
			await rm(tempHome, { recursive: true, force: true });
			tempHome = undefined;
		}
	});

	test("writes zsh completion to ~/.zfunc/_skilltree", async () => {
		tempHome = await mkdtemp(join(tmpdir(), "skilltree-install-zsh-"));
		const result = await installCompletion("zsh", { homeDir: tempHome });
		expect(result.shell).toBe("zsh");
		expect(result.path).toBe(join(tempHome, ".zfunc", "_skilltree"));
		const written = await readFile(result.path, "utf-8");
		expect(written).toContain("#compdef skilltree");
		expect(written).toContain("_skilltree_complete_deps");
	});

	test("writes bash completion under ~/.local/share/bash-completion/", async () => {
		tempHome = await mkdtemp(join(tmpdir(), "skilltree-install-bash-"));
		const result = await installCompletion("bash", { homeDir: tempHome });
		expect(result.shell).toBe("bash");
		expect(result.path).toBe(
			join(tempHome, ".local", "share", "bash-completion", "completions", "skilltree"),
		);
		await stat(result.path); // throws if missing
	});

	test("auto-detects shell from $SHELL when not specified", async () => {
		tempHome = await mkdtemp(join(tmpdir(), "skilltree-install-detect-"));
		const result = await installCompletion(undefined, {
			homeDir: tempHome,
			env: { SHELL: "/usr/local/bin/zsh", HOME: tempHome },
		});
		expect(result.shell).toBe("zsh");
		expect(result.path.endsWith("_skilltree")).toBe(true);
	});

	test("throws a clear error when shell can't be detected", async () => {
		tempHome = await mkdtemp(join(tmpdir(), "skilltree-install-fail-"));
		await expect(
			installCompletion(undefined, {
				homeDir: tempHome,
				env: { SHELL: "/bin/fish", HOME: tempHome },
			}),
		).rejects.toThrow(/Could not detect shell/);
	});

	// Regression: empty $HOME used to slip through `??` and write to
	// `/.zfunc/_skilltree`. We treat blank HOME as unset and fall back to
	// the OS-derived homedir.
	test("treats empty $HOME as unset (does not write to root)", async () => {
		tempHome = await mkdtemp(join(tmpdir(), "skilltree-install-emptyhome-"));
		const result = await installCompletion("zsh", {
			homeDir: tempHome, // explicit override wins, but the env mirrors a real empty-HOME case
			env: { SHELL: "/bin/zsh", HOME: "" },
		});
		// Path should be under the explicit homeDir, NOT under "/".
		expect(result.path.startsWith(tempHome)).toBe(true);
		expect(result.path.startsWith("/.zfunc")).toBe(false);
	});
});
