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

	test("unvendor on multi-target without --target errors with raw entries", async () => {
		const dir = await setupMultiTargetProject();
		await vendorCommand(dir, { target: "claude" });

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
