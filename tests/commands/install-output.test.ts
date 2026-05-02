/**
 * Tests for `skilltree install` console output formatting.
 *
 * Issue #20: with multiple `install_targets`, the "Install order" block was
 * printed once per target. It should be printed exactly once, and the
 * per-target line should name the agent in human-friendly form.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand } from "../../src/commands/install.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-install-out-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

/** Capture console.log output and return joined string. */
async function captureOutput(fn: () => Promise<void>): Promise<string> {
	const logs: string[] = [];
	const originalLog = console.log;
	console.log = (...args: unknown[]) => logs.push(args.join(" "));
	try {
		await fn();
	} finally {
		console.log = originalLog;
	}
	return logs.join("\n");
}

/** Strip ANSI codes so we can match raw text. */
function stripAnsi(s: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: need to match ANSI escape sequences
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

async function writeManifest(dir: string, content: string): Promise<void> {
	await writeFile(join(dir, "skilltree.yml"), content, "utf-8");
}

describe("install output: single 'Install order' block (issue #20)", () => {
	test("prints 'Install order:' exactly once with multiple install_targets", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "alpha");
		await createLocalSkill(join(dir, "skills"), "beta");

		await writeManifest(
			dir,
			[
				"name: test",
				"install_targets:",
				"  - claude",
				"  - codex",
				"  - cursor",
				"  - gemini",
				"dependencies:",
				"  alpha:",
				"    local: ./skills/alpha",
				"  beta:",
				"    local: ./skills/beta",
				"",
			].join("\n"),
		);

		const output = await captureOutput(() => installCommand(dir, {}));
		const clean = stripAnsi(output);

		// Should appear exactly once even though there are 4 install targets.
		const matches = clean.match(/Install order:/g) ?? [];
		expect(matches.length).toBe(1);
	});

	test("prints 'Install order:' once with a single install_target", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "alpha");

		await writeManifest(
			dir,
			[
				"name: test",
				"install_targets:",
				"  - claude",
				"dependencies:",
				"  alpha:",
				"    local: ./skills/alpha",
				"",
			].join("\n"),
		);

		const output = await captureOutput(() => installCommand(dir, {}));
		const clean = stripAnsi(output);

		const matches = clean.match(/Install order:/g) ?? [];
		expect(matches.length).toBe(1);
	});
});

describe("install output: friendly per-target label (issue #20)", () => {
	test("per-target line uses friendly agent labels", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "alpha");

		await writeManifest(
			dir,
			[
				"name: test",
				"install_targets:",
				"  - claude",
				"  - codex",
				"dependencies:",
				"  alpha:",
				"    local: ./skills/alpha",
				"",
			].join("\n"),
		);

		const output = await captureOutput(() => installCommand(dir, {}));
		const clean = stripAnsi(output);

		// Friendly names appear (one per target).
		expect(clean).toContain("Claude Code");
		expect(clean).toContain("Codex");

		// Resolved directories appear next to the labels.
		expect(clean).toContain(".claude");
		expect(clean).toContain(".agents");

		// Counts use entity-type words instead of "entities" / "skills".
		// At least pluralized "skill" should appear.
		expect(clean).toMatch(/\bskill\b|\bskills\b/);
	});

	test("literal-path target shows path as-is (no friendly label)", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "alpha");

		await writeManifest(
			dir,
			[
				"name: test",
				"install_targets:",
				"  - ./vendor/foo",
				"dependencies:",
				"  alpha:",
				"    local: ./skills/alpha",
				"",
			].join("\n"),
		);

		const output = await captureOutput(() => installCommand(dir, {}));
		const clean = stripAnsi(output);

		// Path should appear in the per-target line.
		expect(clean).toContain("./vendor/foo");
	});
});

describe("frozen install output: friendly tilde path", () => {
	test("frozen install with home-relative installBase shows ~/... not absolute path", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeManifest(
			dir,
			["name: test", "dependencies:", "  my-skill:", "    local: ./skills/my-skill", ""].join("\n"),
		);

		// Regular install first to produce lockfile.
		await installCommand(dir, {});

		// Frozen install with installBase pointing under home — exercises the
		// `collapseTilde` fallback in `frozenTarget`.
		const home = homedir();
		const homeBase = join(home, ".skilltree-test-home-base");
		try {
			const output = await captureOutput(() =>
				installCommand(dir, { frozen: true, installPath: homeBase }),
			);
			const clean = stripAnsi(output);
			// Friendly tilde form must appear; raw home prefix must not.
			expect(clean).toContain("~/.skilltree-test-home-base");
			expect(clean).not.toContain(home);
		} finally {
			await rm(homeBase, { recursive: true, force: true });
		}
	});
});

describe("install output: 'entities' wording removed (issue #20)", () => {
	test("does not use the opaque 'entities' jargon in per-target line", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "alpha");

		await writeManifest(
			dir,
			[
				"name: test",
				"install_targets:",
				"  - claude",
				"dependencies:",
				"  alpha:",
				"    local: ./skills/alpha",
				"",
			].join("\n"),
		);

		const output = await captureOutput(() => installCommand(dir, {}));
		const clean = stripAnsi(output);

		// "Installing N entities..." should be gone — replaced by the friendly line.
		expect(clean).not.toMatch(/Installing \d+ entities/);
	});
});
