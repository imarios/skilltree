import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Issue #92: The post-merge `auto-setup-on-bump` hook used to run `make setup`,
 * which invokes `skilltree teach` against the contributor's *personal* global
 * manifest. If that manifest temporarily fails to resolve, the merge succeeds
 * but the local binary is left stale and the failure is buried in the merge
 * scrollback.
 *
 * The contract this test pins down:
 *
 *   1. A separate `setup-bump` make target exists for the post-merge hook to
 *      call. It must not run `teach` (either by passing `SKILTREE_SKIP_TEACH=1`
 *      to a guarded `setup`, or by omitting the `teach` line entirely).
 *   2. `make setup` continues to run `teach` for contributors who deliberately
 *      want to refresh the global skill install. If it's gated, the gate must
 *      key off `SKILTREE_SKIP_TEACH`.
 *   3. The post-merge hook in `.pre-commit-config.yaml` calls `setup-bump`,
 *      not `setup`.
 *
 * These are structural assertions on the Makefile / pre-commit config text
 * rather than dry-run output because GNU make's `-n` still expands recursive
 * `$(MAKE)` calls and prints conditional branches verbatim, so dry-run output
 * can't distinguish "teach gated off" from "teach unconditionally executed".
 */

const repoRoot = join(import.meta.dir, "..", "..");

function readMakefile(): string {
	return readFileSync(join(repoRoot, "Makefile"), "utf8");
}

/**
 * Extract a Make recipe body (the lines following `name:` up to the next
 * target line or blank line followed by a new target). Returns just the
 * recipe lines (tab-indented) joined by newlines.
 */
function extractRecipe(makefile: string, target: string): string {
	const lines = makefile.split("\n");
	const startIdx = lines.findIndex((line) => new RegExp(`^${target}\\s*:`).test(line));
	if (startIdx === -1) return "";
	const body: string[] = [];
	for (let i = startIdx + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) break;
		// Recipe lines must start with a tab. Anything else ends the recipe.
		if (line === "") continue;
		if (!line.startsWith("\t")) break;
		body.push(line);
	}
	return body.join("\n");
}

describe("post-merge auto-setup hook (issue #92)", () => {
	test("`setup-bump` target exists in the Makefile", () => {
		const makefile = readMakefile();
		expect(makefile).toMatch(/^setup-bump\s*:/m);
	});

	test("`setup-bump` recipe does NOT invoke `teach` (directly or via unguarded setup)", () => {
		const makefile = readMakefile();
		const recipe = extractRecipe(makefile, "setup-bump");
		expect(recipe.length, "setup-bump recipe is empty").toBeGreaterThan(0);
		// Direct teach call would be a bug.
		expect(recipe).not.toMatch(/\bcli\.ts teach\b/);
		// If it delegates to `setup` (recursive make), it must pass the skip flag.
		if (/\$\(MAKE\)\s+setup\b/.test(recipe)) {
			expect(recipe).toMatch(/SKILTREE_SKIP_TEACH\s*=\s*1/);
		}
	});

	test("`setup` recipe still calls `teach` by default, but gates it on `SKILTREE_SKIP_TEACH`", () => {
		const makefile = readMakefile();
		const recipe = extractRecipe(makefile, "setup");
		expect(recipe.length).toBeGreaterThan(0);
		expect(recipe).toMatch(/\bcli\.ts teach\b/);
		// The teach line must be guarded by SKILTREE_SKIP_TEACH so the bump-path
		// invocation can opt out without skipping anything else.
		const teachLine = recipe.split("\n").find((line) => /\bcli\.ts teach\b/.test(line));
		expect(teachLine ?? "").toMatch(/SKILTREE_SKIP_TEACH/);
	});

	test("post-merge hook calls `make setup-bump`, not `make setup`", () => {
		const config = readFileSync(join(repoRoot, ".pre-commit-config.yaml"), "utf8");
		// Slice from the auto-setup-on-bump id down to the next `- id:` block
		// (or end of file) — that's the recipe we care about.
		const startMatch = config.match(/-\s*id:\s*auto-setup-on-bump\b/);
		expect(
			startMatch,
			"auto-setup-on-bump hook not found in .pre-commit-config.yaml",
		).not.toBeNull();
		const start = startMatch?.index ?? 0;
		const rest = config.slice(start + (startMatch?.[0].length ?? 0));
		const nextHook = rest.search(/\n\s*-\s*id:\s*/);
		const block = nextHook === -1 ? rest : rest.slice(0, nextHook);
		// Narrow to the `entry:` line (the actual executable recipe) — block-level
		// comments are allowed to mention `make setup` in prose, but the recipe
		// itself must not invoke it.
		const entryLine = block.split("\n").find((line) => line.trimStart().startsWith("entry:"));
		expect(entryLine, "entry: line not found in hook block").toBeDefined();
		expect(entryLine ?? "").toMatch(/\bmake\s+setup-bump\b/);
		// The standalone token `make setup` (followed by a non-`-` character)
		// must not appear in the bump-path recipe, or we've regressed.
		expect(entryLine ?? "").not.toMatch(/\bmake\s+setup\b(?!-)/);
	});
});
