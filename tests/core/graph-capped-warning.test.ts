/**
 * Issue #119 Bug A: silent sibling downgrade.
 *
 * When multiple deps from the same repo are added with `version: "*"` and a
 * later dep from the same repo carries a tightening constraint like `^0.5.0`,
 * the resolver re-pins all three to a commit satisfying ALL constraints —
 * silently downgrading the `*` deps.
 *
 * Fix: emit a "capped by" warning naming the `*` deps that would otherwise
 * have resolved to a higher version and the constraining sibling that caps
 * them.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { resolveAll } from "../../src/core/graph.js";
import type { Manifest } from "../../src/types.js";
import { addTagToRepo, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-capped-"));
	return tempDir;
}

async function makeBareClone(repoDir: string, baseDir: string, name: string): Promise<string> {
	const bareDir = join(baseDir, `${name}.git`);
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	return bareDir;
}

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("resolver: warn when * deps are capped by a sibling's tight constraint (#119)", () => {
	test("two * deps + one ^0.5.0 dep from same repo → warn that the * deps are capped", async () => {
		const dir = await makeTempDir();
		// Repo with three command files, tagged at v0.5.0 and v0.8.0.
		const repoDir = await createTestRepo(
			dir,
			"vibes",
			[
				{ path: "commands/exp.md", name: "exp", isAgent: true },
				{ path: "commands/commit-all.md", name: "commit-all", isAgent: true },
				{ path: "commands/tut.md", name: "tut", isAgent: true },
			],
			"v0.5.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "vibes-bare");
		await addTagToRepo(repoDir, bareDir, "v0.8.0", [
			{ path: "commands/exp.md", name: "exp", isAgent: true },
			{ path: "commands/commit-all.md", name: "commit-all", isAgent: true },
			{ path: "commands/tut.md", name: "tut", isAgent: true },
		]);

		const manifest: Manifest = {
			dependencies: {
				exp: {
					repo: `file://${bareDir}`,
					path: "commands/exp.md",
					type: "agent",
					version: "*",
				},
				"commit-all": {
					repo: `file://${bareDir}`,
					path: "commands/commit-all.md",
					type: "agent",
					version: "*",
				},
				tut: {
					repo: `file://${bareDir}`,
					path: "commands/tut.md",
					type: "agent",
					version: "^0.5.0",
				},
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);

		// All three resolve to 0.5.0 (intersection of *, *, ^0.5.0 against
		// tags [0.5.0, 0.8.0]). That's the existing behavior — what we're
		// adding is the warning attribution.
		expect(result.entities.get("agent:exp")?.version).toBe("0.5.0");
		expect(result.entities.get("agent:commit-all")?.version).toBe("0.5.0");
		expect(result.entities.get("agent:tut")?.version).toBe("0.5.0");

		// A warning must name the capped * deps and the constraining sibling.
		const cappedWarning = result.warnings.find(
			(w) => /capped|cap/i.test(w) && w.includes("0.5.0") && w.includes("0.8.0"),
		);
		expect(cappedWarning).toBeDefined();
		// The warning should name both * deps (so users can find them in their
		// own manifest) and the constraining sibling.
		expect(cappedWarning).toMatch(/\bexp\b/);
		expect(cappedWarning).toMatch(/\bcommit-all\b/);
		expect(cappedWarning).toMatch(/\btut\b/);
	});

	test("no warning when * dep resolves at the highest available tag", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"vibes",
			[
				{ path: "commands/a.md", name: "a", isAgent: true },
				{ path: "commands/b.md", name: "b", isAgent: true },
			],
			"v1.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "vibes-bare");

		const manifest: Manifest = {
			dependencies: {
				a: { repo: `file://${bareDir}`, path: "commands/a.md", type: "agent", version: "*" },
				b: {
					repo: `file://${bareDir}`,
					path: "commands/b.md",
					type: "agent",
					version: "^1.0.0",
				},
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		// 1.0.0 is both the max tag and the intersection result → no cap.
		const cappedWarning = result.warnings.find((w) => /capped|cap/i.test(w));
		expect(cappedWarning).toBeUndefined();
	});

	test("no warning when all deps share the same explicit constraint", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"vibes",
			[
				{ path: "commands/a.md", name: "a", isAgent: true },
				{ path: "commands/b.md", name: "b", isAgent: true },
			],
			"v0.5.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "vibes-bare");
		await addTagToRepo(repoDir, bareDir, "v0.8.0", [
			{ path: "commands/a.md", name: "a", isAgent: true },
			{ path: "commands/b.md", name: "b", isAgent: true },
		]);

		const manifest: Manifest = {
			dependencies: {
				a: {
					repo: `file://${bareDir}`,
					path: "commands/a.md",
					type: "agent",
					version: "^0.5.0",
				},
				b: {
					repo: `file://${bareDir}`,
					path: "commands/b.md",
					type: "agent",
					version: "^0.5.0",
				},
			},
		};

		const result = await resolveAll(manifest, dir);
		expect(result.errors).toEqual([]);
		// Both explicitly opted into ^0.5.0; no * dep is silently downgraded.
		const cappedWarning = result.warnings.find((w) => /capped|cap/i.test(w));
		expect(cappedWarning).toBeUndefined();
	});
});
