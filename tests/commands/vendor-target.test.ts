import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProgram } from "../../src/cli.js";
import { unvendorCommand, vendorCommand } from "../../src/commands/vendor.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

/**
 * Regression coverage for issue #69:
 *   "vendor: error message advertises --target flag that is neither
 *    registered nor forwarded"
 *
 * Three coupled bugs:
 *   1. `--target` not registered on `vendor` / `unvendor` commands
 *   2. Action wrapper drops `opts.target` instead of forwarding it
 *   3. Multi-target error message lists *resolved paths* (.claude, .agents)
 *      instead of *raw install_targets entries* (claude, codex) — so even
 *      when --target lands, users learn the wrong vocabulary
 */

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-vendor-target-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function setupMultiTargetProject(): Promise<string> {
	const dir = await makeTempDir();
	await writeFile(
		join(dir, "skilltree.yml"),
		`name: test
install_targets:
  - claude
  - codex
dependencies:
  foo:
    local: ./skills/foo
`,
	);
	await writeFile(
		join(dir, ".gitignore"),
		".claude/skills/\n.claude/agents/\n.agents/skills/\n.agents/agents/\n",
	);
	await createLocalSkill(join(dir, "skills"), "foo");
	return dir;
}

describe("vendor --target (issue #69)", () => {
	describe("CLI registration", () => {
		test("`vendor` registers --target <name>", () => {
			const program = buildProgram();
			const vendor = program.commands.find((c) => c.name() === "vendor");
			expect(vendor).toBeDefined();
			const opt = vendor?.options.find((o) => o.long === "--target");
			expect(opt, "vendor must register --target").toBeDefined();
			// Must require a value — bare flag is meaningless
			expect(opt?.required).toBe(true);
		});

		test("`unvendor` registers --target <name>", () => {
			const program = buildProgram();
			const unvendor = program.commands.find((c) => c.name() === "unvendor");
			expect(unvendor).toBeDefined();
			const opt = unvendor?.options.find((o) => o.long === "--target");
			expect(opt, "unvendor must register --target").toBeDefined();
			expect(opt?.required).toBe(true);
		});
	});

	describe("error message vocabulary (raw install_targets, not resolved paths)", () => {
		test("multi-target without --target lists raw entries (`claude, codex`)", async () => {
			const dir = await setupMultiTargetProject();
			let caught: Error | undefined;
			try {
				await vendorCommand(dir, {});
			} catch (e) {
				caught = e as Error;
			}
			expect(caught).toBeDefined();
			const msg = caught?.message ?? "";
			// Raw names appear
			expect(msg).toContain("claude");
			expect(msg).toContain("codex");
			// Resolved paths must NOT appear — they mislead the user about what
			// to type after --target
			expect(msg).not.toContain(".claude");
			expect(msg).not.toContain(".agents");
			// Mentions the flag affordance
			expect(msg).toContain("--target");
		});
	});

	describe("--target selects which install target to vendor", () => {
		test("--target claude vendors into .claude/", async () => {
			const dir = await setupMultiTargetProject();
			await vendorCommand(dir, { target: "claude" });
			expect(existsSync(join(dir, ".claude/skills/foo"))).toBe(true);
			expect(existsSync(join(dir, ".agents/skills/foo"))).toBe(false);
		});

		test("--target codex vendors into .agents/ (codex's registry dir)", async () => {
			const dir = await setupMultiTargetProject();
			await vendorCommand(dir, { target: "codex" });
			expect(existsSync(join(dir, ".agents/skills/foo"))).toBe(true);
			expect(existsSync(join(dir, ".claude/skills/foo"))).toBe(false);
		});
	});

	describe("--target validation", () => {
		test("unknown --target produces a hard error listing configured targets", async () => {
			const dir = await setupMultiTargetProject();
			let caught: Error | undefined;
			try {
				await vendorCommand(dir, { target: "bogus" });
			} catch (e) {
				caught = e as Error;
			}
			expect(caught).toBeDefined();
			const msg = caught?.message ?? "";
			expect(msg).toContain("bogus");
			expect(msg).toContain("claude");
			expect(msg).toContain("codex");
			// Don't leak resolved paths into the validation error either
			expect(msg).not.toContain(".claude");
			expect(msg).not.toContain(".agents");
		});

		test("--target is rejected on a single-target manifest (no choice to make)", async () => {
			const dir = await makeTempDir();
			await writeFile(
				join(dir, "skilltree.yml"),
				`name: test
install_targets:
  - claude
dependencies:
  foo:
    local: ./skills/foo
`,
			);
			await writeFile(join(dir, ".gitignore"), ".claude/skills/\n.claude/agents/\n");
			await createLocalSkill(join(dir, "skills"), "foo");

			// claude is configured — passes
			await vendorCommand(dir, { target: "claude" });
			expect(existsSync(join(dir, ".claude/skills/foo"))).toBe(true);

			// codex isn't configured — must hard-error, not silently vendor there
			let caught: Error | undefined;
			try {
				await vendorCommand(dir, { target: "codex" });
			} catch (e) {
				caught = e as Error;
			}
			expect(caught).toBeDefined();
			expect(caught?.message).toContain("codex");
		});
	});

	describe("backward compatibility", () => {
		test("single install_target manifest still vendors without --target", async () => {
			const dir = await makeTempDir();
			await writeFile(
				join(dir, "skilltree.yml"),
				`name: test
install_targets:
  - claude
dependencies:
  foo:
    local: ./skills/foo
`,
			);
			await writeFile(join(dir, ".gitignore"), ".claude/skills/\n.claude/agents/\n");
			await createLocalSkill(join(dir, "skills"), "foo");
			await vendorCommand(dir, {});
			expect(existsSync(join(dir, ".claude/skills/foo"))).toBe(true);
		});

		test("legacy dev_install_path manifest still vendors without --target", async () => {
			const dir = await makeTempDir();
			await writeFile(
				join(dir, "skilltree.yml"),
				`name: test
dev_install_path: .claude
dependencies:
  foo:
    local: ./skills/foo
`,
			);
			await writeFile(join(dir, ".gitignore"), ".claude/skills/\n.claude/agents/\n");
			await createLocalSkill(join(dir, "skills"), "foo");
			await vendorCommand(dir, {});
			expect(existsSync(join(dir, ".claude/skills/foo"))).toBe(true);
		});
	});
});

describe("unvendor --target (issue #69, symmetric)", () => {
	test("unvendor --target codex undoes a vendor --target codex", async () => {
		const dir = await setupMultiTargetProject();
		await vendorCommand(dir, { target: "codex" });
		expect(existsSync(join(dir, ".agents/skills/foo"))).toBe(true);

		// manifest now has vendor: true
		const before = await readFile(join(dir, "skilltree.yml"), "utf-8");
		expect(before).toContain("vendor: true");

		await unvendorCommand(dir, { target: "codex" });
		expect(existsSync(join(dir, ".agents/skills/foo"))).toBe(false);

		const after = await readFile(join(dir, "skilltree.yml"), "utf-8");
		expect(after).not.toContain("vendor: true");
	});

	test("legacy `vendor: true` (no recorded target) on multi-target errors when --target omitted", async () => {
		// Construct a manifest in the legacy state: vendor: true (bare boolean,
		// no `vendored_target:` sibling) on a multi-target manifest. This is
		// what older skilltree versions produced before #89.
		const dir = await setupMultiTargetProject();
		await vendorCommand(dir, { target: "claude" });
		// Strip the recorded target to simulate the legacy state.
		const yml = await readFile(join(dir, "skilltree.yml"), "utf-8");
		await writeFile(join(dir, "skilltree.yml"), yml.replace(/^vendored_target:.*\n/m, ""));

		let caught: Error | undefined;
		try {
			await unvendorCommand(dir, {});
		} catch (e) {
			caught = e as Error;
		}
		expect(caught).toBeDefined();
		const msg = caught?.message ?? "";
		expect(msg).toContain("--target");
		expect(msg).toContain("claude");
		expect(msg).toContain("codex");
		expect(msg).not.toContain(".claude");
		expect(msg).not.toContain(".agents");
	});

	test("unvendor --target rejects unknown target", async () => {
		const dir = await setupMultiTargetProject();
		await vendorCommand(dir, { target: "claude" });

		let caught: Error | undefined;
		try {
			await unvendorCommand(dir, { target: "bogus" });
		} catch (e) {
			caught = e as Error;
		}
		expect(caught).toBeDefined();
		expect(caught?.message).toContain("bogus");
	});
});

/**
 * Regression coverage for issue #89:
 *   "vendor: manifest doesn't record which target was vendored, so
 *    unvendor --target can silently mismatch"
 *
 * Fix shape: `vendor --target X` records `vendored_target: X` in the
 * manifest. `unvendor` consults that field — uses it as the implicit
 * target when --target is omitted, and hard-errors when --target
 * disagrees with what was actually vendored.
 *
 * Legacy `vendor: true` manifests (no recorded target) keep working
 * via the original resolveVendorTarget contract — see the "legacy"
 * test above.
 */
describe("vendor records which target was vendored (issue #89)", () => {
	test("vendor --target codex records `vendored_target: codex` in the manifest", async () => {
		const dir = await setupMultiTargetProject();
		await vendorCommand(dir, { target: "codex" });
		const yml = await readFile(join(dir, "skilltree.yml"), "utf-8");
		expect(yml).toContain("vendor: true");
		expect(yml).toContain("vendored_target: codex");
	});

	test("vendor on a single-target manifest records the sole target", async () => {
		const dir = await makeTempDir();
		await writeFile(
			join(dir, "skilltree.yml"),
			`name: test
install_targets:
  - claude
dependencies:
  foo:
    local: ./skills/foo
`,
		);
		await writeFile(join(dir, ".gitignore"), ".claude/skills/\n.claude/agents/\n");
		await createLocalSkill(join(dir, "skills"), "foo");
		await vendorCommand(dir, {});
		const yml = await readFile(join(dir, "skilltree.yml"), "utf-8");
		expect(yml).toContain("vendored_target: claude");
	});

	test("vendor on a legacy `dev_install_path` manifest does NOT record a target", async () => {
		// No install_targets => no named target exists. The CLI mustn't
		// fabricate one in the manifest, or unvendor would later reject the
		// recorded value as "unknown target" on the next round-trip.
		const dir = await makeTempDir();
		await writeFile(
			join(dir, "skilltree.yml"),
			`name: test
dev_install_path: .claude
dependencies:
  foo:
    local: ./skills/foo
`,
		);
		await writeFile(join(dir, ".gitignore"), ".claude/skills/\n.claude/agents/\n");
		await createLocalSkill(join(dir, "skills"), "foo");
		await vendorCommand(dir, {});
		const yml = await readFile(join(dir, "skilltree.yml"), "utf-8");
		expect(yml).toContain("vendor: true");
		expect(yml).not.toContain("vendored_target");
	});

	test("unvendor (no --target) infers the recorded target on a multi-target manifest", async () => {
		const dir = await setupMultiTargetProject();
		await vendorCommand(dir, { target: "codex" });
		expect(existsSync(join(dir, ".agents/skills/foo"))).toBe(true);

		// No --target: previously this would error on a multi-target manifest.
		// Now it should consult `vendored_target: codex` and unvendor cleanly.
		await unvendorCommand(dir, {});
		expect(existsSync(join(dir, ".agents/skills/foo"))).toBe(false);

		const yml = await readFile(join(dir, "skilltree.yml"), "utf-8");
		expect(yml).not.toContain("vendor: true");
		expect(yml).not.toContain("vendored_target");
	});

	test("unvendor --target Y errors when the manifest recorded a different X", async () => {
		const dir = await setupMultiTargetProject();
		await vendorCommand(dir, { target: "codex" });

		let caught: Error | undefined;
		try {
			await unvendorCommand(dir, { target: "claude" });
		} catch (e) {
			caught = e as Error;
		}
		expect(caught).toBeDefined();
		const msg = caught?.message ?? "";
		expect(msg).toContain("claude");
		expect(msg).toContain("codex");
		// The error must clearly distinguish "what you asked" from
		// "what was actually vendored" — vague mismatches make the user
		// guess which one to trust.
		expect(msg.toLowerCase()).toMatch(/vendored|recorded|mismatch/);

		// Files on disk must NOT be touched — a refusal to act, not a half-clean.
		expect(existsSync(join(dir, ".agents/skills/foo"))).toBe(true);
	});

	test("unvendor --target matching the recorded target succeeds", async () => {
		const dir = await setupMultiTargetProject();
		await vendorCommand(dir, { target: "codex" });
		await unvendorCommand(dir, { target: "codex" });
		expect(existsSync(join(dir, ".agents/skills/foo"))).toBe(false);
	});

	test("legacy `vendor: true` manifest (no recorded target) accepts --target without mismatch error", async () => {
		// A manifest written by an older skilltree (or hand-edited): vendor:
		// true with no `vendored_target:`. The user supplies --target — we
		// have nothing to cross-check against, so the operation must proceed
		// rather than spuriously erroring.
		const dir = await setupMultiTargetProject();
		await vendorCommand(dir, { target: "claude" });
		const yml = await readFile(join(dir, "skilltree.yml"), "utf-8");
		await writeFile(join(dir, "skilltree.yml"), yml.replace(/^vendored_target:.*\n/m, ""));

		await unvendorCommand(dir, { target: "claude" });
		expect(existsSync(join(dir, ".claude/skills/foo"))).toBe(false);
	});
});

describe("vendor target-switch cleanup (issue #108)", () => {
	test("switching --target from claude to codex empties .claude and gitignores it again", async () => {
		const dir = await setupMultiTargetProject();

		await vendorCommand(dir, { target: "claude" });
		expect(existsSync(join(dir, ".claude/skills/foo"))).toBe(true);

		await vendorCommand(dir, { target: "codex" });

		// New target populated.
		expect(existsSync(join(dir, ".agents/skills/foo"))).toBe(true);
		// Old target's tree no longer on disk.
		expect(existsSync(join(dir, ".claude/skills/foo"))).toBe(false);
		// Old target's gitignore entries restored.
		const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
		expect(gitignore).toContain(".claude/skills/");
		// New target's gitignore entries removed (vendored = committable).
		expect(gitignore).not.toMatch(/^\.agents\/skills\/$/m);
		// vendored_target now reflects the new target.
		const yml = await readFile(join(dir, "skilltree.yml"), "utf-8");
		expect(yml).toContain("vendored_target: codex");
	});

	test("re-running vendor against the same --target is a no-op for cleanup", async () => {
		// Cleanup must only fire on an actual target switch. Re-vendoring the
		// same target is the normal "refresh sources" path and should not
		// delete + re-add anything.
		const dir = await setupMultiTargetProject();
		await vendorCommand(dir, { target: "claude" });
		expect(existsSync(join(dir, ".claude/skills/foo"))).toBe(true);

		// Second run with the same target: still vendored, no stale gitignore add.
		await vendorCommand(dir, { target: "claude" });
		expect(existsSync(join(dir, ".claude/skills/foo"))).toBe(true);
		const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
		expect(gitignore).not.toMatch(/^\.claude\/skills\/$/m);
	});
});
