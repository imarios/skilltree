import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { depsTreeCommand } from "../../src/commands/deps.js";
import { installCommand } from "../../src/commands/install.js";
import { createLocalSkill, createTestRepo } from "../helpers/git-fixtures.js";

/**
 * Build the synthetic skill→command→command chain that mirrors the
 * real-world chain (development-methodology → code-refinement-with-hypothesis
 * → hypothesis) used to motivate issues #45 and #47. All three entities are
 * also top-level deps so the duplicate-suppression code paths fire.
 */
async function setupDeepChain(dir: string): Promise<void> {
	await mkdir(join(dir, "commands"), { recursive: true });
	await writeFile(join(dir, "commands", "hypothesize.md"), "---\nname: hypothesize\n---\nBody\n");
	await writeFile(
		join(dir, "commands", "refine.md"),
		"---\nname: refine\ndependencies:\n  - hypothesize\n---\nBody\n",
	);
	await createLocalSkill(join(dir, "skills"), "methodology", ["refine"]);
	await writeFile(
		join(dir, "skilltree.yml"),
		[
			"dependencies:",
			"  refine:",
			"    local: ./commands/refine.md",
			"    type: command",
			"  hypothesize:",
			"    local: ./commands/hypothesize.md",
			"    type: command",
			"  methodology:",
			"    local: ./skills/methodology",
			"",
		].join("\n"),
	);
	await installCommand(dir, {});
}

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-deps-tree-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function writeManifest(dir: string, content: string): Promise<void> {
	await writeFile(join(dir, "skilltree.yml"), content, "utf-8");
}

async function makeBareClone(repoDir: string, baseDir: string, name: string): Promise<string> {
	const bareDir = join(baseDir, `${name}.git`);
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	return bareDir;
}

/**
 * Strip ANSI escape codes so assertions match plain text.
 */
function stripAnsi(s: string): string {
	// biome-ignore lint: regex for ANSI stripping
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function captureConsole(fn: () => Promise<void>): Promise<string[]> {
	const lines: string[] = [];
	const original = console.log;
	console.log = (...args: unknown[]) => lines.push(args.join(" "));
	return fn()
		.then(() => {
			// Strip ANSI, then filter to only tree output lines.
			// Tree lines match: entity entries like "name (type, ...)" or connectors (├── └── │)
			// This filters out noise from parallel tests bleeding into the capture.
			return lines
				.map(stripAnsi)
				.filter(
					(l) =>
						/\(skill[,)]/.test(l) ||
						/\(agent[,)]/.test(l) ||
						/\(command[,)]/.test(l) ||
						l.includes("deduped)") ||
						l.includes("(*)"),
				);
		})
		.finally(() => {
			console.log = original;
		});
}

describe("deps tree rendering", () => {
	test("renders tree connectors for children of root nodes", async () => {
		const dir = await makeTempDir();

		// Parent depends on two children
		await createLocalSkill(join(dir, "skills"), "child-a");
		await createLocalSkill(join(dir, "skills"), "child-b");
		await createLocalSkill(join(dir, "skills"), "parent", ["child-a", "child-b"]);

		await writeManifest(
			dir,
			"dependencies:\n  parent:\n    local: ./skills/parent\n  child-a:\n    local: ./skills/child-a\n  child-b:\n    local: ./skills/child-b\n",
		);

		await installCommand(dir, {});

		const lines = await captureConsole(() => depsTreeCommand(dir));

		// Root should have no connector
		expect(lines[0]).toBe("parent (skill, local)");
		// Children of root should have tree connectors
		expect(lines.some((l) => l.includes("├── child-a"))).toBe(true);
		expect(lines.some((l) => l.includes("└── child-b"))).toBe(true);
	});

	test("renders nested tree with │ continuation lines", async () => {
		const dir = await makeTempDir();

		// A → B → C (chain)
		await createLocalSkill(join(dir, "skills"), "leaf");
		await createLocalSkill(join(dir, "skills"), "mid", ["leaf"]);
		await createLocalSkill(join(dir, "skills"), "top", ["mid"]);

		await writeManifest(
			dir,
			"dependencies:\n  top:\n    local: ./skills/top\n  mid:\n    local: ./skills/mid\n  leaf:\n    local: ./skills/leaf\n",
		);

		await installCommand(dir, {});

		const lines = await captureConsole(() => depsTreeCommand(dir));

		expect(lines[0]).toBe("top (skill, local)");
		expect(lines[1]).toBe("└── mid (skill, local)");
		expect(lines[2]).toBe("    └── leaf (skill, local)");
	});

	test("default: diamond shows full topology with (*) marker on transitive duplicates (issue #47)", async () => {
		const dir = await makeTempDir();

		// Diamond: A→B, A→C, B→D, C→D
		await createLocalSkill(join(dir, "skills"), "shared");
		await createLocalSkill(join(dir, "skills"), "left", ["shared"]);
		await createLocalSkill(join(dir, "skills"), "right", ["shared"]);
		await createLocalSkill(join(dir, "skills"), "root", ["left", "right"]);

		await writeManifest(
			dir,
			"dependencies:\n  root:\n    local: ./skills/root\n  left:\n    local: ./skills/left\n  right:\n    local: ./skills/right\n  shared:\n    local: ./skills/shared\n",
		);

		await installCommand(dir, {});

		const lines = await captureConsole(() => depsTreeCommand(dir));

		// `shared` appears unmarked under its first transitive site (left's
		// subtree) AND at top-level (top-level entries are always canonical).
		// At the second transitive site (right's subtree), `(*)` marks it.
		const dupShared = lines.filter((l) => l.includes("shared") && l.includes("(*)"));
		expect(dupShared.length).toBeGreaterThanOrEqual(1);

		// "deduped" wording is gone in the default output — that lives on --dedupe.
		expect(lines.some((l) => l.includes("deduped)"))).toBe(false);
	});

	test("default: deep chain duplicated under multiple parents shows full topology (issue #47)", async () => {
		const dir = await makeTempDir();
		await setupDeepChain(dir);

		const lines = await captureConsole(() => depsTreeCommand(dir));

		const startIdx = lines.findIndex((l) => l.startsWith("methodology"));
		expect(startIdx).toBeGreaterThanOrEqual(0);
		const subtree = lines.slice(startIdx);
		const subtreeRefine = subtree.filter((l) => l.includes("refine") && l.includes("(*)"));
		const subtreeHypo = subtree.filter((l) => l.includes("hypothesize") && l.includes("(*)"));
		expect(subtreeRefine.length).toBe(1);
		expect(subtreeHypo.length).toBe(1);
	});

	test("top-level entry is canonical even when already printed as a transitive (issue #47)", async () => {
		// Iteration order: refine, then hypothesize (which was already printed
		// as refine's transitive), then methodology. The top-level hypothesize
		// line must be canonical — it's a direct project dep, not a duplicate.
		// The marker only belongs on transitive occurrences.
		const dir = await makeTempDir();
		await setupDeepChain(dir);

		const lines = await captureConsole(() => depsTreeCommand(dir));

		// The top-level `hypothesize` line (no leading connector — root-level)
		// must NOT carry the (*) marker.
		const topLevelHypo = lines.find((l) => l.startsWith("hypothesize") && l.includes("(command"));
		expect(topLevelHypo).toBeDefined();
		expect(topLevelHypo).not.toContain("(*)");
	});

	test("--dedupe preserves the legacy terse view (issue #47)", async () => {
		const dir = await makeTempDir();

		await createLocalSkill(join(dir, "skills"), "shared");
		await createLocalSkill(join(dir, "skills"), "left", ["shared"]);
		await createLocalSkill(join(dir, "skills"), "right", ["shared"]);
		await createLocalSkill(join(dir, "skills"), "root", ["left", "right"]);

		await writeManifest(
			dir,
			"dependencies:\n  root:\n    local: ./skills/root\n  left:\n    local: ./skills/left\n  right:\n    local: ./skills/right\n  shared:\n    local: ./skills/shared\n",
		);

		await installCommand(dir, {});

		const lines = await captureConsole(() => depsTreeCommand(dir, { dedupe: true }));

		// With --dedupe, the duplicate carries the legacy "deduped" wording AND
		// no children are rendered below it.
		const dedupedShared = lines.filter((l) => l.includes("shared (skill, deduped)"));
		expect(dedupedShared.length).toBeGreaterThanOrEqual(1);
		// Sanity: (*) marker should not appear under --dedupe.
		expect(lines.some((l) => l.includes("(*)"))).toBe(false);
	});

	test("renders remote deps with version", async () => {
		const dir = await makeTempDir();

		const repoDir = await createTestRepo(
			dir,
			"repo",
			[
				{ path: "skills/child", name: "child" },
				{ path: "skills/parent", name: "parent", dependencies: ["child"] },
			],
			"v2.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "bare");

		await writeManifest(
			dir,
			`dependencies:\n  parent:\n    repo: "file://${bareDir}"\n    path: skills/parent\n    version: "*"\n`,
		);

		await installCommand(dir, {});

		const lines = await captureConsole(() => depsTreeCommand(dir));

		expect(lines[0]).toBe("parent@2.0.0 (skill)");
		expect(lines[1]).toBe("└── child@2.0.0 (skill)");
	});

	test("--json emits a nested object tree per root", async () => {
		const dir = await makeTempDir();

		await createLocalSkill(join(dir, "skills"), "leaf");
		await createLocalSkill(join(dir, "skills"), "mid", ["leaf"]);
		await createLocalSkill(join(dir, "skills"), "top", ["mid"]);

		await writeManifest(
			dir,
			"dependencies:\n  top:\n    local: ./skills/top\n  mid:\n    local: ./skills/mid\n  leaf:\n    local: ./skills/leaf\n",
		);

		await installCommand(dir, {});

		const lines: string[] = [];
		const original = console.log;
		console.log = (...args: unknown[]) => lines.push(args.join(" "));
		try {
			await depsTreeCommand(dir, { json: true });
		} finally {
			console.log = original;
		}

		// Single JSON line — array of root entries
		expect(lines).toHaveLength(1);
		const parsed = JSON.parse(lines[0] ?? "");
		expect(Array.isArray(parsed)).toBe(true);

		// "top" is a root and should have a nested "mid → leaf" subtree
		const topRoot = parsed.find((r: { name: string }) => r.name === "top");
		expect(topRoot).toBeDefined();
		expect(topRoot.type).toBe("skill");
		expect(topRoot.source).toBe("local");
		expect(Array.isArray(topRoot.dependencies)).toBe(true);
		expect(topRoot.dependencies).toHaveLength(1);
		expect(topRoot.dependencies[0].name).toBe("mid");
		expect(topRoot.dependencies[0].dependencies[0].name).toBe("leaf");
	});

	test("--json emits [] for an empty manifest", async () => {
		const dir = await makeTempDir();
		await writeManifest(dir, "dependencies: {}\n");
		await installCommand(dir, {});

		const lines: string[] = [];
		const original = console.log;
		console.log = (...args: unknown[]) => lines.push(args.join(" "));
		try {
			await depsTreeCommand(dir, { json: true });
		} finally {
			console.log = original;
		}

		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0] ?? "")).toEqual([]);
	});

	test("--json default: deduped nodes still carry populated `dependencies` (issue #47)", async () => {
		const dir = await makeTempDir();
		await setupDeepChain(dir);

		const lines: string[] = [];
		const original = console.log;
		console.log = (...args: unknown[]) => lines.push(args.join(" "));
		try {
			await depsTreeCommand(dir, { json: true });
		} finally {
			console.log = original;
		}

		const parsed = JSON.parse(lines[0] ?? "");
		const methodology = parsed.find((r: { name: string }) => r.name === "methodology");
		expect(methodology).toBeDefined();
		const refineUnderMeth = methodology.dependencies.find(
			(d: { name: string }) => d.name === "refine",
		);
		expect(refineUnderMeth).toBeDefined();
		expect(refineUnderMeth.deduped).toBe(true);
		expect(refineUnderMeth.dependencies.length).toBe(1);
		expect(refineUnderMeth.dependencies[0].name).toBe("hypothesize");
		expect(refineUnderMeth.dependencies[0].deduped).toBe(true);
	});

	test("--json --dedupe: deduped nodes have empty `dependencies` (legacy view)", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "shared");
		await createLocalSkill(join(dir, "skills"), "left", ["shared"]);
		await createLocalSkill(join(dir, "skills"), "right", ["shared"]);
		await createLocalSkill(join(dir, "skills"), "root", ["left", "right"]);

		await writeManifest(
			dir,
			"dependencies:\n  root:\n    local: ./skills/root\n  left:\n    local: ./skills/left\n  right:\n    local: ./skills/right\n  shared:\n    local: ./skills/shared\n",
		);

		await installCommand(dir, {});

		const lines: string[] = [];
		const original = console.log;
		console.log = (...args: unknown[]) => lines.push(args.join(" "));
		try {
			await depsTreeCommand(dir, { json: true, dedupe: true });
		} finally {
			console.log = original;
		}

		const parsed = JSON.parse(lines[0] ?? "");
		// At least one duplicate occurrence of `shared` should carry
		// deduped: true AND an empty dependencies array (legacy view).
		const findDeduped = (
			node: { name: string; deduped?: boolean; dependencies: unknown[] },
			results: Array<{ deduped: boolean; depsCount: number }>,
		): void => {
			if (node.name === "shared" && node.deduped === true) {
				results.push({ deduped: true, depsCount: node.dependencies.length });
			}
			for (const child of node.dependencies as Array<{
				name: string;
				deduped?: boolean;
				dependencies: unknown[];
			}>) {
				findDeduped(child, results);
			}
		};
		const results: Array<{ deduped: boolean; depsCount: number }> = [];
		for (const root of parsed) findDeduped(root, results);
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results.every((r) => r.depsCount === 0)).toBe(true);
	});

	test("a cyclic lockfile is rejected at read time with a clear error (issue #47)", async () => {
		// The resolver rejects cycles before writing a lockfile, so a cycle
		// here means corruption (hand-edit, future serialization bug). Surface
		// it as a load-time error rather than letting deps tree silently render
		// a partial graph.
		const dir = await makeTempDir();
		await writeManifest(dir, "dependencies:\n  a:\n    local: ./skills/a\n");
		await writeFile(
			join(dir, "skilltree.lock"),
			[
				"lockfile_version: 1",
				"packages:",
				"  a:",
				"    type: skill",
				"    group: prod",
				"    source: local",
				"    path: ./skills/a",
				"    commit: HEAD",
				"    dependencies: [b]",
				"  b:",
				"    type: skill",
				"    group: prod",
				"    source: local",
				"    path: ./skills/b",
				"    commit: HEAD",
				"    dependencies: [a]",
				"",
			].join("\n"),
		);

		await expect(depsTreeCommand(dir)).rejects.toThrow(/cycle detected/);
	});

	test("renders │ continuation for non-last children with subtrees", async () => {
		const dir = await makeTempDir();

		// root → [branch-a → leaf-a, branch-b → leaf-b]
		await createLocalSkill(join(dir, "skills"), "leaf-a");
		await createLocalSkill(join(dir, "skills"), "leaf-b");
		await createLocalSkill(join(dir, "skills"), "branch-a", ["leaf-a"]);
		await createLocalSkill(join(dir, "skills"), "branch-b", ["leaf-b"]);
		await createLocalSkill(join(dir, "skills"), "root", ["branch-a", "branch-b"]);

		await writeManifest(
			dir,
			"dependencies:\n  root:\n    local: ./skills/root\n  branch-a:\n    local: ./skills/branch-a\n  branch-b:\n    local: ./skills/branch-b\n  leaf-a:\n    local: ./skills/leaf-a\n  leaf-b:\n    local: ./skills/leaf-b\n",
		);

		await installCommand(dir, {});

		const lines = await captureConsole(() => depsTreeCommand(dir));

		// Expected:
		// root (skill, local)
		// ├── branch-a (skill, local)
		// │   └── leaf-a (skill, local)
		// └── branch-b (skill, local)
		//     └── leaf-b (skill, local)
		expect(lines[0]).toBe("root (skill, local)");
		expect(lines[1]).toBe("├── branch-a (skill, local)");
		expect(lines[2]).toBe("│   └── leaf-a (skill, local)");
		expect(lines[3]).toBe("└── branch-b (skill, local)");
		expect(lines[4]).toBe("    └── leaf-b (skill, local)");
	});
});
