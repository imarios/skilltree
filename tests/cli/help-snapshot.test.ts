import { describe, expect, test } from "bun:test";
import type { Command } from "commander";
import { buildProgram } from "../../src/cli.js";

/**
 * Snapshot every command's --help output. Future flag additions, removals,
 * renames, or description changes must update the snapshot — making the
 * change a deliberate review item rather than silent drift.
 *
 * If a snapshot needs intentional updating: run with `bun test --update-snapshots`.
 */

/**
 * Walk the program tree and yield every (path, command) pair, where path
 * is the user-facing command path (e.g. "registry update"). Skips hidden
 * commands (e.g. `_complete`) and the implicit `help` command Commander
 * adds automatically.
 */
function* walkCommands(
	program: Command,
	prefix: string[] = [],
): Generator<{ path: string; command: Command }> {
	for (const cmd of program.commands) {
		if (cmd.name() === "help") continue;
		// Commander 14 stores the `{ hidden: true }` flag in a private `_hidden`
		// field on Command (only `Option.hidden` is public). Stable across the
		// v8-v14 API window — set via `.command(name, { hidden: true })` (we use
		// it for `_complete`).
		// biome-ignore lint/suspicious/noExplicitAny: documented private-field access
		if ((cmd as any)._hidden) continue;
		const path = [...prefix, cmd.name()];
		yield { path: path.join(" "), command: cmd };
		// Recurse into sub-command groups (deps, registry, targets, cache)
		if (cmd.commands.length > 0) {
			yield* walkCommands(cmd, path);
		}
	}
}

/**
 * Capture a command's help text. Uses Commander's helpInformation() which
 * is a pure string-returning API — no stdout writes, no spawning.
 *
 * Per-line trailing whitespace is stripped: Commander column-aligns
 * multi-line descriptions with ~33 spaces of left padding, which means
 * blank "continuation" lines arrive whitespace-padded. The repo's
 * `trailing-whitespace` pre-commit hook then trims those at commit time,
 * so the snapshot file on disk and CI's freshly-generated output diverge
 * by whitespace only. Normalize at snapshot time to keep both sides
 * byte-identical.
 */
function helpText(command: Command): string {
	return command
		.helpInformation()
		.split("\n")
		.map((line) => line.replace(/[ \t]+$/, ""))
		.join("\n");
}

describe("CLI help snapshots", () => {
	const program = buildProgram();

	test("top-level --help is stable", () => {
		expect(helpText(program)).toMatchSnapshot();
	});

	for (const { path, command } of walkCommands(program)) {
		test(`\`${path} --help\` is stable`, () => {
			expect(helpText(command)).toMatchSnapshot();
		});
	}
});
