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

	// Regression: issue #102. When a top-level dep is aliased (YAML key ≠ entity
	// name), transitive references to its name from a sibling's frontmatter must
	// still resolve. The lockfile keys by YAML alias, but `entry.dependencies`
	// holds entity names — so a naive `packages[depName]` lookup misses the
	// aliased entry and silently truncates the subtree.
	test("transitive lookup resolves aliased YAML keys (issue #102)", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "python-coding");
		await createLocalSkill(join(dir, "skills"), "task-builder", ["python-coding"]);

		// `pc` is the YAML alias; the entity name is `python-coding`.
		// task-builder's frontmatter references `python-coding` (the name),
		// so the transitive edge from task-builder must resolve to `pc`'s entry.
		await writeManifest(
			dir,
			[
				"dependencies:",
				"  pc:",
				"    local: ./skills/python-coding",
				"    name: python-coding",
				"  task-builder:",
				"    local: ./skills/task-builder",
				"",
			].join("\n"),
		);
		await installCommand(dir, {});

		const lines = await captureConsole(() => depsTreeCommand(dir));

		// task-builder must show python-coding as a transitive child, not be a
		// leaf. With the bug, lines for task-builder's subtree would end here.
		const taskBuilderIdx = lines.findIndex((l) => l.startsWith("task-builder"));
		expect(taskBuilderIdx).toBeGreaterThanOrEqual(0);
		const childLine = lines[taskBuilderIdx + 1];
		expect(childLine).toBeDefined();
		expect(childLine).toMatch(/└── python-coding/);
	});

	// Same alias bug, second symptom: when an aliased entry is reachable
	// both as a root (under its YAML key) and as a transitive (under its
	// entity name), the dedup tracker treats them as two different entities
	// because it keys on the rendered string. `--dedupe` must still suppress
	// the second occurrence (issue #102).
	test("--dedupe suppresses transitive duplicate of an aliased root (issue #102)", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "python-coding");
		await createLocalSkill(join(dir, "skills"), "task-builder", ["python-coding"]);

		await writeManifest(
			dir,
			[
				"dependencies:",
				"  pc:",
				"    local: ./skills/python-coding",
				"    name: python-coding",
				"  task-builder:",
				"    local: ./skills/task-builder",
				"",
			].join("\n"),
		);
		await installCommand(dir, {});

		const lines = await captureConsole(() => depsTreeCommand(dir, { dedupe: true }));
		// `pc` is rendered as a canonical root. Under task-builder's subtree,
		// the same entity (referenced by its name `python-coding`) must be
		// suppressed with a `deduped` marker — not rendered as a fresh entry.
		const taskBuilderIdx = lines.findIndex((l) => l.startsWith("task-builder"));
		const childLine = lines[taskBuilderIdx + 1];
		expect(childLine).toBeDefined();
		// The dedup label proves the dedup tracker recognized this as the
		// same entity it already printed under the YAML key alias.
		expect(childLine).toContain("deduped");
	});

	// Issue #94: when a remote dep has no semver pin, the tree previously
	// dropped the version suffix entirely — even though `skilltree.lock`
	// records the resolved commit SHA. Mirror the fix already shipped in
	// `list` (issue #76): render `@<short-sha>` as the fallback so users
	// can still identify what was installed.
	test("renders @<short-sha> for unpinned remote deps in text tree (#94)", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"repo",
			[{ path: "skills/unpinned", name: "unpinned" }],
			// No tag → version is undefined in the lockfile; only commit is set.
		);
		const bareDir = await makeBareClone(repoDir, dir, "bare-unpinned");

		await writeManifest(
			dir,
			`dependencies:\n  unpinned:\n    repo: "file://${bareDir}"\n    path: skills/unpinned\n`,
		);
		await installCommand(dir, {});

		const lines = await captureConsole(() => depsTreeCommand(dir));
		// The first (and only) line should be `unpinned@<7-char-sha> (skill)`.
		expect(lines[0]).toMatch(/^unpinned@[0-9a-f]{7} \(skill\)$/);
	});

	test("--json surfaces commit on every non-local entry (#94)", async () => {
		const dir = await makeTempDir();
		const repoDir = await createTestRepo(
			dir,
			"repo-with-commit",
			[
				{ path: "skills/child", name: "child" },
				{ path: "skills/parent", name: "parent", dependencies: ["child"] },
			],
			"v1.0.0",
		);
		const bareDir = await makeBareClone(repoDir, dir, "bare-commit");

		await writeManifest(
			dir,
			`dependencies:\n  parent:\n    repo: "file://${bareDir}"\n    path: skills/parent\n    version: "*"\n`,
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
		const tree = JSON.parse(lines.join("\n")) as Array<{
			name: string;
			commit?: string;
			version?: string;
			dependencies: Array<{ name: string; commit?: string }>;
		}>;
		const parent = tree[0];
		expect(parent).toBeDefined();
		expect(parent?.commit).toMatch(/^[0-9a-f]{40}$/); // full SHA in JSON
		expect(parent?.version).toBe("1.0.0");
		expect(parent?.dependencies[0]?.commit).toMatch(/^[0-9a-f]{40}$/);
	});

	test("--json omits commit on local deps (commit: HEAD is meaningless there) (#94)", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "local-only");
		await writeManifest(dir, "dependencies:\n  local-only:\n    local: ./skills/local-only\n");
		await installCommand(dir, {});

		const lines: string[] = [];
		const original = console.log;
		console.log = (...args: unknown[]) => lines.push(args.join(" "));
		try {
			await depsTreeCommand(dir, { json: true });
		} finally {
			console.log = original;
		}
		const tree = JSON.parse(lines.join("\n")) as Array<{ name: string; commit?: string }>;
		expect(tree[0]?.name).toBe("local-only");
		expect(tree[0]?.commit).toBeUndefined();
	});

	// Issue #107: an aliased entry (YAML key ≠ entity name) previously rendered
	// under its YAML key when reached as a root and under its entity name when
	// reached as a transitive. Same entity, two labels in one tree. The fix
	// uses `entry.name ?? key` consistently — so the root now matches the
	// transitive label.
	test("aliased entry uses canonical entity name as a root (#107)", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "python-coding");

		await writeManifest(
			dir,
			[
				"dependencies:",
				"  pc:",
				"    local: ./skills/python-coding",
				"    name: python-coding",
				"",
			].join("\n"),
		);
		await installCommand(dir, {});

		const lines = await captureConsole(() => depsTreeCommand(dir));
		// Root renders under the canonical name, not the YAML key.
		expect(lines[0]).toBe("python-coding (skill, local)");
		// And the YAML alias does not leak into the rendering.
		expect(lines.some((l) => /^pc[\s(]/.test(l))).toBe(false);
	});

	test("aliased root and its transitive occurrence share one label (#107)", async () => {
		// Aliased entry reached both as a root (`pc`) AND as a transitive
		// (`python-coding` from task-builder's frontmatter). After the fix,
		// both lines say `python-coding`.
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "python-coding");
		await createLocalSkill(join(dir, "skills"), "task-builder", ["python-coding"]);

		await writeManifest(
			dir,
			[
				"dependencies:",
				"  pc:",
				"    local: ./skills/python-coding",
				"    name: python-coding",
				"  task-builder:",
				"    local: ./skills/task-builder",
				"",
			].join("\n"),
		);
		await installCommand(dir, {});

		const lines = await captureConsole(() => depsTreeCommand(dir));
		// Both the root and the transitive must use the same label.
		const rootLine = lines.find((l) => l === "python-coding (skill, local)");
		const transitiveLine = lines.find((l) => /└── python-coding/.test(l));
		expect(rootLine).toBeDefined();
		expect(transitiveLine).toBeDefined();
		// `pc` (the YAML alias) must not appear as a node label.
		expect(lines.some((l) => /^pc[\s(]/.test(l))).toBe(false);
	});

	test("--json: aliased root uses canonical entity name (#107)", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "python-coding");

		await writeManifest(
			dir,
			[
				"dependencies:",
				"  pc:",
				"    local: ./skills/python-coding",
				"    name: python-coding",
				"",
			].join("\n"),
		);
		await installCommand(dir, {});

		const jsonLines: string[] = [];
		const original = console.log;
		console.log = (...args: unknown[]) => jsonLines.push(args.join(" "));
		try {
			await depsTreeCommand(dir, { json: true });
		} finally {
			console.log = original;
		}
		const tree = JSON.parse(jsonLines.join("\n")) as Array<{ name: string }>;
		expect(tree).toHaveLength(1);
		expect(tree[0]?.name).toBe("python-coding");
	});

	test("json: transitive lookup resolves aliased YAML keys (issue #102)", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "python-coding");
		await createLocalSkill(join(dir, "skills"), "task-builder", ["python-coding"]);

		await writeManifest(
			dir,
			[
				"dependencies:",
				"  pc:",
				"    local: ./skills/python-coding",
				"    name: python-coding",
				"  task-builder:",
				"    local: ./skills/task-builder",
				"",
			].join("\n"),
		);
		await installCommand(dir, {});

		const jsonLines: string[] = [];
		const original = console.log;
		console.log = (...args: unknown[]) => jsonLines.push(args.join(" "));
		try {
			await depsTreeCommand(dir, { json: true });
		} finally {
			console.log = original;
		}
		const tree = JSON.parse(jsonLines.join("\n")) as Array<{
			name: string;
			dependencies: Array<{ name: string }>;
		}>;
		const taskBuilder = tree.find((n) => n.name === "task-builder");
		expect(taskBuilder).toBeDefined();
		// python-coding must surface as a child even though it's stored under
		// the YAML key `pc`.
		expect(taskBuilder?.dependencies.map((d) => d.name)).toContain("python-coding");
	});
});
