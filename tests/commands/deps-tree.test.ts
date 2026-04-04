import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { depsTreeCommand } from "../../src/commands/deps.js";
import { installCommand } from "../../src/commands/install.js";
import { createLocalSkill, createTestRepo } from "../helpers/git-fixtures.js";

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
	await writeFile(join(dir, "skilltree.yaml"), content, "utf-8");
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
				.filter((l) => /\(skill[,)]/.test(l) || /\(agent[,)]/.test(l) || l.includes("deduped)"));
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

	test("renders deduped entries correctly", async () => {
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

		// shared should appear once fully, rest as deduped
		// (once under left's subtree, then deduped under right and as root entry)
		const fullShared = lines.filter((l) => l.includes("shared (skill, local)"));
		const dedupedShared = lines.filter((l) => l.includes("shared (skill, deduped)"));
		expect(fullShared.length).toBe(1);
		expect(dedupedShared.length).toBeGreaterThanOrEqual(1);
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
