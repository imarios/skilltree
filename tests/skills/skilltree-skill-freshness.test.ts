import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const SKILL_DIR = join(import.meta.dir, "..", "..", "skills", "skilltree");
const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli.ts");
const README_PATH = join(import.meta.dir, "..", "..", "README.md");

/**
 * Extract registered commands and options from cli.ts source.
 * Parses .command() and .option() calls.
 */
async function extractCliDefinitions(): Promise<{
	commands: string[];
	options: Map<string, string[]>;
}> {
	const source = await readFile(CLI_PATH, "utf-8");
	const commands: string[] = [];
	const options = new Map<string, string[]>();
	let currentCmd = "";

	const lines = source.split("\n");
	for (const line of lines) {
		const cmdMatch = line.match(/\.command\(["']([a-z][\w-]*)/);
		if (cmdMatch?.[1]) {
			currentCmd = cmdMatch[1];
			commands.push(currentCmd);
			options.set(currentCmd, []);
		}

		const optMatch = line.match(/\.option\(["'][^"']*?(--[\w-]+)/);
		if (optMatch?.[1] && currentCmd) {
			options.get(currentCmd)?.push(optMatch[1]);
		}
	}

	return { commands, options };
}

// Subcommands documented under their parent (e.g., "tree" → "deps tree")
const SUBCOMMAND_PARENTS: Record<string, string> = {
	tree: "deps tree",
	clean: "cache clean",
	index: "registry index",
	detect: "targets detect",
	migrate: "targets migrate",
};

describe("skilltree skill freshness", () => {
	test("commands.md covers all CLI commands", async () => {
		const commandsMd = await readFile(join(SKILL_DIR, "references", "commands.md"), "utf-8");
		const { commands } = await extractCliDefinitions();

		const missing: string[] = [];
		for (const cmd of commands) {
			const searchTerm = SUBCOMMAND_PARENTS[cmd]
				? `skilltree ${SUBCOMMAND_PARENTS[cmd]}`
				: `skilltree ${cmd}`;
			if (!commandsMd.includes(searchTerm)) {
				missing.push(cmd);
			}
		}

		if (missing.length > 0) {
			throw new Error(
				`commands.md is missing documentation for: ${missing.join(", ")}\nUpdate skills/skilltree/references/commands.md to match the CLI.`,
			);
		}
	});

	test("commands.md covers all CLI flags", async () => {
		const commandsMd = await readFile(join(SKILL_DIR, "references", "commands.md"), "utf-8");
		const { options } = await extractCliDefinitions();

		const missing: string[] = [];
		for (const [cmd, flags] of options) {
			for (const flag of flags) {
				if (!commandsMd.includes(flag)) {
					missing.push(`${cmd}: ${flag}`);
				}
			}
		}

		if (missing.length > 0) {
			throw new Error(
				`commands.md is missing flags:\n${missing.map((m) => `  - ${m}`).join("\n")}\nUpdate skills/skilltree/references/commands.md to match the CLI.`,
			);
		}
	});

	test("SKILL.md frontmatter is valid", async () => {
		const skillMd = await readFile(join(SKILL_DIR, "SKILL.md"), "utf-8");
		expect(skillMd.startsWith("---")).toBe(true);
		expect(skillMd).toContain("name: skilltree");
		expect(skillMd).toContain("description:");
	});

	// Issue #116: README's Commands table is a separate source of truth from
	// `commands.md` and was drifting silently — `skilltree check` shipped weeks
	// before it appeared in the README table, while the narrative section
	// already referenced it. This mirrors the `commands.md` freshness check
	// against `README.md` so the next absent row fails CI instead of waiting
	// for someone to notice.
	test("README.md Commands table covers all CLI commands (#116)", async () => {
		const readme = await readFile(README_PATH, "utf-8");
		const { commands } = await extractCliDefinitions();

		const missing: string[] = [];
		for (const cmd of commands) {
			const searchTerm = SUBCOMMAND_PARENTS[cmd]
				? `skilltree ${SUBCOMMAND_PARENTS[cmd]}`
				: `skilltree ${cmd}`;
			if (!readme.includes(searchTerm)) {
				missing.push(cmd);
			}
		}

		if (missing.length > 0) {
			throw new Error(
				`README.md is missing documentation for: ${missing.join(", ")}\nUpdate the Commands table in README.md to match the CLI.`,
			);
		}
	});

	test("workflows.md references all major commands", async () => {
		const workflowsMd = await readFile(join(SKILL_DIR, "references", "workflows.md"), "utf-8");
		const criticalCommands = ["install", "add", "update", "remove", "scan", "teach"];

		const missing: string[] = [];
		for (const cmd of criticalCommands) {
			if (!workflowsMd.includes(`skilltree ${cmd}`)) {
				missing.push(cmd);
			}
		}

		if (missing.length > 0) {
			throw new Error(
				`workflows.md is missing workflows for: ${missing.join(", ")}\nUpdate skills/skilltree/references/workflows.md to include these commands.`,
			);
		}
	});
});
