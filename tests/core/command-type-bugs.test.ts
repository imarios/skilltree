/**
 * Hypothesis-driven probes for the command-type rollout (Issue #11).
 *
 * Each test states a suspected bug and either confirms or refutes it.
 * Confirmed bugs become regression tests after the fix lands; refuted
 * hypotheses stay as guard-rails so the property can't silently break.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mdFileType } from "../../src/core/entity-type.js";
import { resolveAll } from "../../src/core/graph.js";
import { scanLocalRepo } from "../../src/core/repo-scanner.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function makeTempDir(prefix: string): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), prefix));
	return tempDir;
}

/**
 * H1 — A `commands/` segment ANYWHERE in a path is treated as the
 * top-level commands bucket. A skill that organizes internal helper
 * `.md` files under `<skill>/commands/` would have those helpers
 * mis-classified as slash commands.
 */
describe("H1: mid-path commands/ segment false positive", () => {
	test("mdFileType returns 'command' for a deeply nested commands/ segment", () => {
		// Pure unit-level confirmation that the helper itself doesn't
		// distinguish "top-level commands/" from "commands/ inside a skill".
		expect(mdFileType("skills/my-skill/commands/helper.md")).toBe("command");
		expect(mdFileType("a/b/c/commands/d/e.md")).toBe("command");
	});

	test("scanLocalRepo does NOT recurse into skill directories — internal helpers stay scoped", async () => {
		// Regression for H1: previously, a skill that used an internal
		// `commands/` subdir for helper docs (plausible authoring pattern —
		// the `references/` convention exists but isn't enforced) would have
		// each helper mis-classified as a top-level slash command. The fix
		// is for `walk()` to stop descending when it sees a SKILL.md, the
		// same way `index-cmd.ts` already did.
		const dir = await makeTempDir("skilltree-h1-");
		await mkdir(join(dir, "skills", "my-skill", "commands"), { recursive: true });
		await writeFile(
			join(dir, "skills", "my-skill", "SKILL.md"),
			"---\nname: my-skill\ndescription: A skill with internal helpers\n---\nBody\n",
		);
		await writeFile(
			join(dir, "skills", "my-skill", "commands", "helper.md"),
			"---\nname: helper\ndescription: An internal helper doc\n---\nBody\n",
		);

		const entries = await scanLocalRepo(dir);
		// Only the skill should surface — the helper is internal to it.
		expect(entries.map((e) => e.name)).toEqual(["my-skill"]);
		expect(entries.find((e) => e.name === "helper")).toBeUndefined();
	});

	test("an explicit dep at a path inside a skill is still classified by mdFileType (not the scanner)", async () => {
		// mdFileType keeps its loose definition because explicit consumer
		// declarations are intentional — if you `add foo --path
		// skills/x/commands/y.md`, you really do mean "extract this single
		// file and install it as a command". The auto-discovery path is the
		// one that needs the stop-at-skill guard, not type inference.
		expect(mdFileType("skills/x/commands/y.md")).toBe("command");
	});
});

/**
 * H2 — Same-name skill and command. Different install dirs, no FS
 * collision, but the resolution context can only point to one entity.
 * Per the existing aliasing rule (registerEntity in graph.ts), skill
 * always wins. Verify this still works for skill-vs-command, and that
 * both entities still install.
 */
describe("H2: same-name skill + command collision", () => {
	test("both install when declared as separate manifest entries with the same name", async () => {
		const dir = await makeTempDir("skilltree-h2-");
		await mkdir(join(dir, "skills", "review"), { recursive: true });
		await writeFile(
			join(dir, "skills", "review", "SKILL.md"),
			"---\nname: review\ndescription: Review skill\n---\nBody\n",
		);
		await mkdir(join(dir, "commands"), { recursive: true });
		await writeFile(
			join(dir, "commands", "review.md"),
			"---\nname: review\ndescription: Review command\n---\nBody\n",
		);

		// YAML keys must be unique, so alias the command via a different key
		// + name override (the documented aliasing pattern from spec.md).
		const result = await resolveAll(
			{
				dependencies: {
					review: { local: "./skills/review", type: "skill" },
					"review-cmd": { local: "./commands/review.md", type: "command", name: "review" },
				},
			},
			dir,
		);

		expect(result.errors).toEqual([]);
		expect(result.entities.has("skill:review")).toBe(true);
		expect(result.entities.has("command:review")).toBe(true);
	});

	test("a transitive `dependencies: [review]` from an agent resolves to the skill, not the command", async () => {
		// The aliasing precedence rule from registerEntity says skill wins
		// in the resolution context. An agent saying `dependencies: [review]`
		// when both a skill and command named "review" exist must point at
		// the skill (and obviously, the skill→skill rule means the inverse
		// would be a constraint error anyway).
		const dir = await makeTempDir("skilltree-h2b-");
		await mkdir(join(dir, "skills", "review"), { recursive: true });
		await writeFile(join(dir, "skills", "review", "SKILL.md"), "---\nname: review\n---\nBody\n");
		await mkdir(join(dir, "commands"), { recursive: true });
		await writeFile(join(dir, "commands", "review.md"), "---\nname: review\n---\nBody\n");
		await mkdir(join(dir, "agents"), { recursive: true });
		await writeFile(
			join(dir, "agents", "inspector.md"),
			"---\nname: inspector\ndependencies:\n  - review\n---\nBody\n",
		);

		const result = await resolveAll(
			{
				dependencies: {
					inspector: { local: "./agents/inspector.md", type: "agent" },
					review: { local: "./skills/review", type: "skill" },
					"review-cmd": { local: "./commands/review.md", type: "command", name: "review" },
				},
			},
			dir,
		);

		expect(result.errors).toEqual([]);

		// inspector's transitive resolved to the skill (skill wins), confirmed
		// by the topo edge: skill must come before agent. The command can sit
		// anywhere relative to the agent — it has no edge to either.
		const order = result.installOrder;
		expect(order.indexOf("skill:review")).toBeLessThan(order.indexOf("agent:inspector"));
	});
});

/**
 * H3 — The skill→non-skill type-constraint error is pushed from two
 * places: `checkExistingResolution` (transitive path) and
 * `validateTypeConstraints` (post-pass). validateTypeConstraints has a
 * `state.errors.includes(errMsg)` dedup guard. checkExistingResolution
 * doesn't. Confirm whether the same edge produces one error or two.
 */
describe("H3: type-constraint error duplication", () => {
	test("a skill→command edge produces exactly one error message", async () => {
		const dir = await makeTempDir("skilltree-h3-");
		await mkdir(join(dir, "my-skill"), { recursive: true });
		await writeFile(
			join(dir, "my-skill", "SKILL.md"),
			"---\nname: my-skill\ndependencies:\n  - review\n---\nBody\n",
		);
		await mkdir(join(dir, "commands"), { recursive: true });
		await writeFile(join(dir, "commands", "review.md"), "---\nname: review\n---\nBody\n");

		const result = await resolveAll(
			{
				dependencies: {
					"my-skill": { local: "./my-skill" },
					review: { local: "./commands/review.md", type: "command" },
				},
			},
			dir,
		);

		// Count how many error strings mention the same edge.
		const edgeErrors = result.errors.filter(
			(e) => e.includes("skill:my-skill") && e.includes("command:review"),
		);
		expect(edgeErrors.length).toBe(1);
	});
});

/**
 * H6 — `--scan` (scanLocalRepo) must not pick up installed artifacts
 * under `.claude/commands/` as if they were sources. The walker skips
 * hidden directories; verify that property still holds for the new
 * commands/ bucket.
 */
describe("H6: scanLocalRepo skips installed commands under .claude/", () => {
	test("an installed .claude/commands/review.md is NOT discovered as a source", async () => {
		const dir = await makeTempDir("skilltree-h6-");
		await mkdir(join(dir, ".claude", "commands"), { recursive: true });
		await writeFile(
			join(dir, ".claude", "commands", "review.md"),
			"---\nname: review\n---\nBody\n",
		);
		// Also add a real source command at the top level for contrast.
		await mkdir(join(dir, "commands"), { recursive: true });
		await writeFile(join(dir, "commands", "lint.md"), "---\nname: lint\n---\nBody\n");

		const entries = await scanLocalRepo(dir);
		const names = entries.map((e) => e.name);

		expect(names).toContain("lint");
		expect(names).not.toContain("review");
	});
});
