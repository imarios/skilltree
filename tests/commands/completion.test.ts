import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { generateBashCompletion, generateZshCompletion } from "../../src/commands/completion.js";

const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli.ts");

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
		const zsh = generateZshCompletion();

		const allFlags: string[] = [];
		for (const [, flags] of options) {
			for (const flag of flags) {
				allFlags.push(flag);
			}
		}

		for (const flag of allFlags) {
			expect(zsh).toContain(flag);
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
		const bash = generateBashCompletion();

		const allFlags: string[] = [];
		for (const [, flags] of options) {
			for (const flag of flags) {
				allFlags.push(flag);
			}
		}

		for (const flag of allFlags) {
			expect(bash).toContain(flag);
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
});
