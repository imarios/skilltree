import { describe, expect, test } from "bun:test";
import type { Command } from "commander";
import { buildProgram } from "../../src/cli.js";

/**
 * Parity guards: assert that every command in a given category exposes the
 * expected flag. Catches the failure mode where someone adds a new
 * mutating command but forgets to wire `-n, --dry-run`, or a new
 * read-shaped command that forgets `--json`.
 *
 * The allowlists below are the source of truth — when adding a new
 * command, add it to the appropriate set (or explicitly note why it
 * doesn't fit the pattern).
 */

/**
 * Commands whose primary effect is to mutate the filesystem or manifest /
 * lockfile state. Each MUST accept `-n, --dry-run`.
 *
 * Excluded by design:
 * - `init`: creates a new manifest; preview mode would be near-empty
 * - `add`: a single-file mutation users iterate on; preview is low-value
 * - `targets {add,remove,detect,migrate}`: small, transactional manifest edits
 * - `registry {add,remove,update,init}`: out-of-band cache mutations,
 *   not project state — preview unclear
 */
const MUTATING_COMMANDS = ["install", "update", "remove", "vendor", "unvendor"];

/**
 * Commands whose primary effect is to read state and produce output.
 * Each MUST accept `--json` so scripted consumers can parse the result.
 *
 * Excluded by design:
 * - `info`: not yet machine-introspectable across project + global state
 * - `completion`, `teach`, `registry index`, `registry add/remove`,
 *   `targets add/remove/detect/migrate`: not list-shaped output
 */
const READSHAPED_COMMANDS = [
	"verify",
	"list",
	"scan",
	"search",
	"info",
	"registry list",
	"registry update",
	"targets list",
	"deps tree",
	"cache clean",
];

/**
 * Commands that operate over project OR global state and need a way to
 * select which. Each MUST accept `-g, --global`.
 *
 * Excluded by design:
 * - `scan`, `search`, `vendor`, `unvendor`: don't have a global concept
 * - `registry {*}`: registries are user-global, not project-vs-global
 * - `info`: registry-shaped (logged as a separate item in BACKLOG)
 * - `completion`, `teach`, `cache clean`: process- or env-level, no scope
 */
const STATEFUL_COMMANDS = [
	"init",
	"add",
	"install",
	"update",
	"remove",
	"verify",
	"list",
	"deps tree",
	"targets list",
	"targets add",
	"targets remove",
	"targets detect",
	"targets migrate",
];

function* walkCommands(
	program: Command,
	prefix: string[] = [],
): Generator<{ path: string; command: Command }> {
	for (const cmd of program.commands) {
		if (cmd.name() === "help") continue;
		// See note on `_hidden` in tests/cli/help-snapshot.test.ts
		// biome-ignore lint/suspicious/noExplicitAny: documented private-field access
		if ((cmd as any)._hidden) continue;
		const path = [...prefix, cmd.name()];
		yield { path: path.join(" "), command: cmd };
		if (cmd.commands.length > 0) {
			yield* walkCommands(cmd, path);
		}
	}
}

function findCommand(program: Command, path: string): Command | undefined {
	const parts = path.split(" ");
	let current: Command = program;
	for (const part of parts) {
		const next = current.commands.find((c) => c.name() === part);
		if (!next) return undefined;
		current = next;
	}
	return current;
}

function commandHasOption(command: Command, longFlag: string): boolean {
	return command.options.some((o) => o.long === longFlag);
}

describe("CLI flag parity", () => {
	const program = buildProgram();

	describe("--dry-run on mutating commands", () => {
		for (const path of MUTATING_COMMANDS) {
			test(`\`${path}\` accepts -n, --dry-run`, () => {
				const cmd = findCommand(program, path);
				expect(cmd, `command \`${path}\` not found in program`).toBeDefined();
				if (!cmd) return;
				expect(commandHasOption(cmd, "--dry-run")).toBe(true);
				const opt = cmd.options.find((o) => o.long === "--dry-run");
				expect(opt?.short).toBe("-n");
			});
		}
	});

	describe("--json on read-shaped commands", () => {
		for (const path of READSHAPED_COMMANDS) {
			test(`\`${path}\` accepts --json`, () => {
				const cmd = findCommand(program, path);
				expect(cmd, `command \`${path}\` not found in program`).toBeDefined();
				if (!cmd) return;
				expect(commandHasOption(cmd, "--json")).toBe(true);
			});
		}
	});

	describe("-g, --global on stateful commands", () => {
		for (const path of STATEFUL_COMMANDS) {
			test(`\`${path}\` accepts -g, --global`, () => {
				const cmd = findCommand(program, path);
				expect(cmd, `command \`${path}\` not found in program`).toBeDefined();
				if (!cmd) return;
				expect(commandHasOption(cmd, "--global")).toBe(true);
				const opt = cmd.options.find((o) => o.long === "--global");
				expect(opt?.short).toBe("-g");
			});
		}
	});

	describe("no command in MUTATING_COMMANDS uses -n for something else", () => {
		// Soft check: across the whole tree, if a command exposes -n, it MUST
		// be --dry-run. Catches accidental short-flag overload (the central
		// concern of issue #23).
		for (const { path, command } of walkCommands(program)) {
			const dashN = command.options.find((o) => o.short === "-n");
			if (dashN) {
				test(`\`${path}\`'s -n maps to --dry-run`, () => {
					expect(dashN.long).toBe("--dry-run");
				});
			}
		}
	});
});
