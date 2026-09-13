import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addCommand } from "../../src/commands/add.js";
import { initCommand } from "../../src/commands/init.js";
import { installCommand } from "../../src/commands/install.js";
import { removeCommand, resolveRemoveSkipConfirmation } from "../../src/commands/remove.js";
import { readLockfile } from "../../src/core/lockfile.js";
import { readManifest } from "../../src/core/manifest.js";
import { _resetDeprecationWarningsForTests } from "../../src/core/ui.js";
import { createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-remove-"));
	await initCommand(tempDir, { isInteractive: false });
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("removeCommand", () => {
	/**
	 * #205: an aliased dep installs under its real name (`name:`), not its
	 * manifest key. `remove` built the install path from the key, found nothing
	 * there, and reported success with the files still in place.
	 */
	test("removes an aliased dep's files, which live under its real name", async () => {
		const dir = await setup();
		const repo = await createTestRepo(
			dir,
			"aliasrepo",
			[{ path: "skills/bar", name: "bar" }],
			"1.0.0",
		);
		await writeFile(
			join(dir, "skilltree.yml"),
			`install_targets: [claude]\ndependencies:\n  my-bar:\n    repo: file://${repo}\n    path: skills/bar\n    version: "*"\n    name: bar\n`,
		);
		await installCommand(dir, {});
		const installed = join(dir, ".claude", "skills", "bar");
		await stat(installed);

		await removeCommand("my-bar", dir, { yes: true });

		await expect(stat(installed)).rejects.toThrow();
	});

	test("removes a dependency from manifest", async () => {
		const dir = await setup();
		await addCommand("my-skill", { repo: "github.com/user/repo", path: "skills/my-skill" }, dir);

		await removeCommand("my-skill", dir, { yes: true });

		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.["my-skill"]).toBeUndefined();
	});

	test("errors when name is not in manifest", async () => {
		const dir = await setup();

		await expect(removeCommand("nonexistent", dir, { yes: true })).rejects.toThrow(
			"not in skilltree.yml",
		);
	});

	test("removes from dev-dependencies", async () => {
		const dir = await setup();
		await addCommand(
			"dev-skill",
			{ repo: "github.com/user/repo", path: "skills/dev-skill", dev: true },
			dir,
		);

		await removeCommand("dev-skill", dir, { yes: true });

		const manifest = await readManifest(dir);
		expect(manifest["dev-dependencies"]?.["dev-skill"]).toBeUndefined();
	});

	test("errors on transitive-only dep", async () => {
		const dir = await setup();
		await addCommand("parent", { repo: "github.com/user/repo", path: "skills/parent" }, dir);

		// Write a lockfile with a transitive dep
		await writeFile(
			join(dir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  parent:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/parent\n    version: 1.0.0\n    commit: abc\n    dependencies:\n      - transitive-dep\n  transitive-dep:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/transitive-dep\n    version: 1.0.0\n    commit: abc\n    dependencies: []\n",
		);

		await expect(removeCommand("transitive-dep", dir, { yes: true })).rejects.toThrow(
			"transitive dependency",
		);
	});

	test("--force removes even when dependents exist", async () => {
		const dir = await setup();
		await addCommand("base", { repo: "github.com/user/repo", path: "skills/base" }, dir);
		await addCommand("consumer", { repo: "github.com/user/repo", path: "skills/consumer" }, dir);

		// Write lockfile with consumer depending on base
		await writeFile(
			join(dir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  base:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/base\n    version: 1.0.0\n    commit: abc\n    dependencies: []\n  consumer:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/consumer\n    version: 1.0.0\n    commit: abc\n    dependencies:\n      - base\n",
		);

		await removeCommand("base", dir, { yes: true });

		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.base).toBeUndefined();
	});

	test("--keep-files leaves installed files in place", async () => {
		const dir = await setup();
		await addCommand("my-skill", { repo: "github.com/user/repo", path: "skills/my-skill" }, dir);

		// Create fake installed files and lockfile
		const installDir = join(dir, ".claude", "skills", "my-skill");
		await mkdir(installDir, { recursive: true });
		await writeFile(join(installDir, "SKILL.md"), "# test\n");
		await writeFile(
			join(dir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  my-skill:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/my-skill\n    version: 1.0.0\n    commit: abc\n    dependencies: []\n",
		);

		await removeCommand("my-skill", dir, { yes: true, keepFiles: true });

		// Manifest should be cleaned
		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.["my-skill"]).toBeUndefined();

		// But files should still exist
		const stats = await stat(installDir);
		expect(stats.isDirectory()).toBe(true);
	});

	test("removes installed files and cleans lockfile", async () => {
		const dir = await setup();
		await addCommand("my-skill", { repo: "github.com/user/repo", path: "skills/my-skill" }, dir);

		const installDir = join(dir, ".claude", "skills", "my-skill");
		await mkdir(installDir, { recursive: true });
		await writeFile(join(installDir, "SKILL.md"), "# test\n");
		await writeFile(
			join(dir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  my-skill:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/my-skill\n    version: 1.0.0\n    commit: abc\n    dependencies: []\n",
		);

		await removeCommand("my-skill", dir, { yes: true });

		// Files should be gone
		await expect(stat(installDir)).rejects.toThrow();

		// Lockfile should not contain the entry
		const lockfile = await readLockfile(dir);
		expect(lockfile?.packages["my-skill"]).toBeUndefined();
	});

	test("orphan cleanup removes unreachable transitive deps", async () => {
		const dir = await setup();
		await addCommand("parent", { repo: "github.com/user/repo", path: "skills/parent" }, dir);

		// Lockfile: parent -> child -> grandchild
		await writeFile(
			join(dir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  parent:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/parent\n    version: 1.0.0\n    commit: abc\n    dependencies:\n      - child\n  child:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/child\n    version: 1.0.0\n    commit: abc\n    dependencies:\n      - grandchild\n  grandchild:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/grandchild\n    version: 1.0.0\n    commit: abc\n    dependencies: []\n",
		);

		await removeCommand("parent", dir, { yes: true });

		const lockfile = await readLockfile(dir);
		expect(lockfile?.packages.parent).toBeUndefined();
		expect(lockfile?.packages.child).toBeUndefined();
		expect(lockfile?.packages.grandchild).toBeUndefined();
	});

	test("--dry-run leaves manifest unchanged and previews what would be removed", async () => {
		const dir = await setup();
		await addCommand("my-skill", { repo: "github.com/user/repo", path: "skills/my-skill" }, dir);

		const installDir = join(dir, ".claude", "skills", "my-skill");
		await mkdir(installDir, { recursive: true });
		await writeFile(join(installDir, "SKILL.md"), "# test\n");
		await writeFile(
			join(dir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  my-skill:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/my-skill\n    version: 1.0.0\n    commit: abc\n    dependencies: []\n",
		);

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			await removeCommand("my-skill", dir, { yes: true, dryRun: true });
		} finally {
			console.log = originalLog;
		}

		// Manifest still has the dep
		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.["my-skill"]).toBeDefined();

		// Files still exist
		const stats = await stat(installDir);
		expect(stats.isDirectory()).toBe(true);

		// Lockfile still has the entry
		const lockfile = await readLockfile(dir);
		expect(lockfile?.packages["my-skill"]).toBeDefined();

		// Output advertises dry-run + names what would be touched
		const output = logs.join("\n");
		expect(output.toLowerCase()).toContain("dry run");
		expect(output).toContain("my-skill");
	});

	test("--dry-run skips the dependents-confirmation prompt", async () => {
		const dir = await setup();
		await addCommand("base", { repo: "github.com/user/repo", path: "skills/base" }, dir);

		// Lockfile makes "consumer" depend on "base" — without --force this would
		// prompt. --dry-run should not prompt either (nothing to confirm in a
		// preview).
		await writeFile(
			join(dir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  base:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/base\n    version: 1.0.0\n    commit: abc\n    dependencies: []\n  consumer:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/consumer\n    version: 1.0.0\n    commit: abc\n    dependencies:\n      - base\n",
		);

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => logs.push(args.join(" "));
		try {
			// No --force; if dry-run didn't bypass the prompt this would hang on stdin
			await removeCommand("base", dir, { dryRun: true });
		} finally {
			console.log = originalLog;
		}

		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.base).toBeDefined();
	});

	test("removes installed files from every install_targets directory", async () => {
		// Regression: `remove` previously cleaned only the first/default install
		// path, leaving orphan copies in other configured targets (e.g.
		// .agents/, .cursor/, .gemini/) when install_targets had >1 entry.
		const dir = await setup();
		// Manually write a multi-target manifest (initCommand writes a fresh one)
		await writeFile(
			join(dir, "skilltree.yml"),
			[
				"name: multi",
				"install_targets:",
				"  - claude",
				"  - codex",
				"  - cursor",
				"  - gemini",
				"dependencies:",
				"  my-skill:",
				"    repo: github.com/user/repo",
				"    version: '*'",
				"    path: skills/my-skill",
				"dev-dependencies: {}",
				"",
			].join("\n"),
		);

		// Simulate `install` by placing files in every target directory
		const targets = [".claude", ".agents", ".cursor", ".gemini"];
		for (const t of targets) {
			const installDir = join(dir, t, "skills", "my-skill");
			await mkdir(installDir, { recursive: true });
			await writeFile(join(installDir, "SKILL.md"), "# test\n");
		}

		await writeFile(
			join(dir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  my-skill:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/my-skill\n    version: 1.0.0\n    commit: abc\n    dependencies: []\n",
		);

		await removeCommand("my-skill", dir, { yes: true });

		// All four target directories should no longer contain the skill
		for (const t of targets) {
			await expect(stat(join(dir, t, "skills", "my-skill"))).rejects.toThrow();
		}
	});

	test("orphan cleanup removes installed files of orphans across all targets", async () => {
		// Regression: orphan cleanup must also iterate every install target.
		const dir = await setup();
		await writeFile(
			join(dir, "skilltree.yml"),
			[
				"name: multi-orphan",
				"install_targets:",
				"  - claude",
				"  - codex",
				"dependencies:",
				"  parent:",
				"    repo: github.com/user/repo",
				"    version: '*'",
				"    path: skills/parent",
				"dev-dependencies: {}",
				"",
			].join("\n"),
		);

		// Simulate install of parent + transitive child in both targets
		const targets = [".claude", ".agents"];
		for (const t of targets) {
			for (const name of ["parent", "child"]) {
				const installDir = join(dir, t, "skills", name);
				await mkdir(installDir, { recursive: true });
				await writeFile(join(installDir, "SKILL.md"), `# ${name}\n`);
			}
		}

		await writeFile(
			join(dir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  parent:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/parent\n    version: 1.0.0\n    commit: abc\n    dependencies:\n      - child\n  child:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/child\n    version: 1.0.0\n    commit: abc\n    dependencies: []\n",
		);

		await removeCommand("parent", dir, { yes: true });

		// Both parent and orphan child files should be gone in every target
		for (const t of targets) {
			await expect(stat(join(dir, t, "skills", "parent"))).rejects.toThrow();
			await expect(stat(join(dir, t, "skills", "child"))).rejects.toThrow();
		}
	});

	describe("--dev flag", () => {
		// `remove --dev` asserts intent: only proceed if the name lives in
		// `dev-dependencies`. Mirrors `add -D` so scripts can be explicit about
		// which group they target. The manifest validator forbids the same
		// name in both groups, so --dev's value is the assertion, not
		// disambiguation between groups.
		test("removes a dev-dependency when --dev is set", async () => {
			const dir = await setup();
			await addCommand(
				"dev-skill",
				{ repo: "github.com/user/repo", path: "skills/dev-skill", dev: true },
				dir,
			);

			await removeCommand("dev-skill", dir, { yes: true, dev: true });

			const manifest = await readManifest(dir);
			expect(manifest["dev-dependencies"]?.["dev-skill"]).toBeUndefined();
		});

		test("errors when --dev is set but name is only in prod dependencies", async () => {
			const dir = await setup();
			await addCommand(
				"prod-only",
				{ repo: "github.com/user/repo", path: "skills/prod-only" },
				dir,
			);

			await expect(removeCommand("prod-only", dir, { yes: true, dev: true })).rejects.toThrow(
				"not in dev-dependencies",
			);

			// And the prod entry is left untouched
			const manifest = await readManifest(dir);
			expect(manifest.dependencies?.["prod-only"]).toBeDefined();
		});

		test("errors when --dev is combined with --global (global has no dev-deps)", async () => {
			const dir = await setup();
			await expect(
				removeCommand("anything", dir, { yes: true, dev: true, global: true }),
			).rejects.toThrow("--dev is not compatible with --global");
		});
	});

	test("orphan cleanup removes installed files of orphans", async () => {
		const dir = await setup();
		await addCommand("parent", { repo: "github.com/user/repo", path: "skills/parent" }, dir);

		// Create installed files for parent and orphan child
		const installBase = join(dir, ".claude");
		await mkdir(join(installBase, "skills", "parent"), { recursive: true });
		await writeFile(join(installBase, "skills", "parent", "SKILL.md"), "# parent\n");
		await mkdir(join(installBase, "skills", "child"), { recursive: true });
		await writeFile(join(installBase, "skills", "child", "SKILL.md"), "# child\n");

		await writeFile(
			join(dir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  parent:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/parent\n    version: 1.0.0\n    commit: abc\n    dependencies:\n      - child\n  child:\n    type: skill\n    group: prod\n    repo: github.com/user/repo\n    path: skills/child\n    version: 1.0.0\n    commit: abc\n    dependencies: []\n",
		);

		await removeCommand("parent", dir, { yes: true });

		// Both parent and orphan child files should be gone
		await expect(stat(join(installBase, "skills", "parent"))).rejects.toThrow();
		await expect(stat(join(installBase, "skills", "child"))).rejects.toThrow();
	});

	// Regression: issue #102. Orphan detection walks `entry.dependencies`
	// (entity names) but indexes by `lockfile.packages[key]` (YAML alias).
	// When a transitive child is aliased, the walk fails to mark it reachable
	// and the orphan sweeper silently deletes a still-needed entry.
	test("does not orphan an aliased transitive that's kept alive only by a sibling root (issue #102)", async () => {
		const dir = await setup();
		await addCommand("unrelated", { repo: "github.com/user/repo", path: "skills/unrelated" }, dir);
		// `pc` is NOT in the manifest — it's a pure transitive of task-builder,
		// reachable only via the entity name `python-coding`. This is exactly
		// the case where the orphan-walk's name-vs-key lookup goes wrong.
		await writeFile(
			join(dir, "skilltree.yml"),
			[
				"dependencies:",
				"  unrelated:",
				"    repo: github.com/user/repo",
				"    path: skills/unrelated",
				"  task-builder:",
				"    repo: github.com/user/repo",
				"    path: skills/task-builder",
				"",
			].join("\n"),
		);
		await writeFile(
			join(dir, "skilltree.lock"),
			[
				"lockfile_version: 1",
				"packages:",
				"  unrelated: {type: skill, group: prod, repo: github.com/user/repo, path: skills/unrelated, version: 1.0.0, commit: abc, dependencies: []}",
				"  pc: {type: skill, group: prod, repo: github.com/user/repo, path: skills/pc, version: 1.0.0, commit: abc, name: python-coding, dependencies: []}",
				"  task-builder: {type: skill, group: prod, repo: github.com/user/repo, path: skills/task-builder, version: 1.0.0, commit: abc, dependencies: [python-coding]}",
				"",
			].join("\n"),
		);

		// Remove the unrelated dep. `pc` is still kept alive by `task-builder`
		// (transitively, via the name `python-coding`). It must NOT be swept
		// as an orphan.
		await removeCommand("unrelated", dir, { yes: true });

		const lockfile = await readLockfile(dir);
		expect(lockfile?.packages.pc).toBeDefined();
		expect(lockfile?.packages["task-builder"]).toBeDefined();
		expect(lockfile?.packages.unrelated).toBeUndefined();
	});
});

function captureWarnings(fn: () => void): string[] {
	const warnings: string[] = [];
	const original = console.warn;
	console.warn = (msg: string) => {
		warnings.push(msg);
	};
	try {
		fn();
	} finally {
		console.warn = original;
	}
	return warnings;
}

/**
 * #23: `remove -f` meant "skip confirmation" while `install -f` and
 * `unvendor -f` mean "overwrite modified files". `-y, --yes` is the
 * confirmation skip everywhere else (`init`, `add`), so `remove` joins them.
 * `--force` keeps working with a deprecation warning, so no script breaks.
 */
describe("resolveRemoveSkipConfirmation (#23)", () => {
	beforeEach(() => {
		_resetDeprecationWarningsForTests();
	});

	test("--yes skips the confirmation without any warning", () => {
		const warnings = captureWarnings(() => {
			expect(resolveRemoveSkipConfirmation({ yes: true })).toBe(true);
		});
		expect(warnings).toEqual([]);
	});

	test("no flag keeps the confirmation", () => {
		expect(resolveRemoveSkipConfirmation({})).toBe(false);
	});

	test("deprecated --force still skips it, and says to use --yes", () => {
		const warnings = captureWarnings(() => {
			expect(resolveRemoveSkipConfirmation({ force: true })).toBe(true);
		});
		expect(warnings.length).toBe(1);
		expect(warnings[0]).toContain("--yes");
		expect(warnings[0]).toContain("DEPRECATION");
	});
});
