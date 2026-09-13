/**
 * Neon Phase 2 (#203): `skilltree freeze <name> [tag]` and `skilltree unfreeze <name>`.
 *
 * Fixture: an upstream repo with `stable` at v0.4.0 and v0.6.0 (v0.6.0 content
 * says "Updated content for v0.6.0"), installed into a scratch project.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { freezeCommand, unfreezeCommand } from "../../src/commands/freeze.js";
import { installCommand } from "../../src/commands/install.js";
import { FROZEN_REF_PREFIX, readRef, repoCachePath } from "../../src/core/git.js";
import { resolveAll } from "../../src/core/graph.js";
import { readLockfile } from "../../src/core/lockfile.js";
import { readManifest } from "../../src/core/manifest.js";
import { addTagToRepo, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string | undefined;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
	tempDir = undefined;
});

interface Fixture {
	projectDir: string;
	bareDir: string;
	repo: string;
	oldCommit: string;
	newCommit: string;
}

async function buildFixture(): Promise<Fixture> {
	const dir = await mkdtemp(join(tmpdir(), "skilltree-freeze-cmd-"));
	tempDir = dir;
	const repoDir = await createTestRepo(
		dir,
		"upstream",
		[{ path: "skills/stable", name: "stable" }],
		"v0.4.0",
	);
	const bareDir = join(dir, "upstream.git");
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	await addTagToRepo(repoDir, bareDir, "v0.6.0", [{ path: "skills/stable", name: "stable" }]);

	const projectDir = join(dir, "project");
	await mkdir(projectDir, { recursive: true });
	const bare = simpleGit(bareDir);
	return {
		projectDir,
		bareDir,
		repo: `file://${bareDir}`,
		oldCommit: (await bare.revparse(["v0.4.0^{commit}"])).trim(),
		newCommit: (await bare.revparse(["v0.6.0^{commit}"])).trim(),
	};
}

async function writeManifestYaml(
	fx: Fixture,
	entry: string,
	group = "dependencies",
): Promise<void> {
	await writeFile(
		join(fx.projectDir, "skilltree.yml"),
		`${group}:
  stable:
    repo: "${fx.repo}"
    path: skills/stable
    type: skill
${entry}`,
	);
}

function manifestBytes(fx: Fixture): Promise<string> {
	return readFile(join(fx.projectDir, "skilltree.yml"), "utf-8");
}

function lockfileBytes(fx: Fixture): Promise<string> {
	return readFile(join(fx.projectDir, "skilltree.lock"), "utf-8");
}

function installedSkill(fx: Fixture): Promise<string> {
	return readFile(join(fx.projectDir, ".claude", "skills", "stable", "SKILL.md"), "utf-8");
}

async function installedAtLatest(): Promise<Fixture> {
	const fx = await buildFixture();
	await writeManifestYaml(fx, '    version: "*"\n');
	await installCommand(fx.projectDir, {});
	return fx;
}

async function stableEntry(fx: Fixture): Promise<Record<string, unknown>> {
	const manifest = await readManifest(fx.projectDir);
	return (manifest.dependencies?.stable ??
		manifest["dev-dependencies"]?.stable) as unknown as Record<string, unknown>;
}

describe("freeze", () => {
	test("FR1 freeze at a tag rewrites the manifest, re-locks and reinstalls at that tag", async () => {
		const fx = await installedAtLatest();

		await freezeCommand(fx.projectDir, "stable", "0.4.0");

		const entry = await stableEntry(fx);
		expect(entry.frozen).toBe("0.4.0");
		expect("version" in entry).toBe(false);
		const locked = (await readLockfile(fx.projectDir))?.packages.stable;
		expect(locked?.version).toBe("0.4.0");
		expect(locked?.frozen).toBe("0.4.0");
		expect(locked?.commit).toBe(fx.oldCommit);
		expect(await installedSkill(fx)).not.toContain("Updated content for v0.6.0");
	});

	test("FR2 freeze without a tag freezes at the locked version", async () => {
		const fx = await installedAtLatest();

		await freezeCommand(fx.projectDir, "stable");

		expect((await stableEntry(fx)).frozen).toBe("0.6.0");
		expect((await readLockfile(fx.projectDir))?.packages.stable?.commit).toBe(fx.newCommit);
	});

	test("FR3 freeze without a tag on a dep that isn't installed asks for a tag", async () => {
		const fx = await buildFixture();
		await writeManifestYaml(fx, '    version: "*"\n');

		await expect(freezeCommand(fx.projectDir, "stable")).rejects.toThrow(/pass a tag/);
	});

	test("FR4 a range is rejected and the manifest is left alone", async () => {
		const fx = await installedAtLatest();
		const before = await manifestBytes(fx);

		await expect(freezeCommand(fx.projectDir, "stable", "^0.4.0")).rejects.toThrow(/exact/);
		expect(await manifestBytes(fx)).toBe(before);
	});

	test("FR5 a tag that doesn't exist upstream is rejected and the manifest is left alone", async () => {
		const fx = await installedAtLatest();
		const before = await manifestBytes(fx);

		await expect(freezeCommand(fx.projectDir, "stable", "0.5.0")).rejects.toThrow(/0\.5\.0/);
		expect(await manifestBytes(fx)).toBe(before);
	});

	test("FR6 an existing version constraint is dropped, and the output says so", async () => {
		const fx = await buildFixture();
		await writeManifestYaml(fx, '    version: "<0.5.0"\n');
		await installCommand(fx.projectDir, {});
		const logs: string[] = [];
		const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			logs.push(args.join(" "));
		});

		try {
			await freezeCommand(fx.projectDir, "stable", "0.4.0");
		} finally {
			spy.mockRestore();
		}

		expect("version" in (await stableEntry(fx))).toBe(false);
		expect(logs.join("\n")).toContain('removed version: "<0.5.0"');
	});

	test("FR7 unknown names, local deps and pack references are rejected", async () => {
		const fx = await buildFixture();
		await writeFile(
			join(fx.projectDir, "skilltree.yml"),
			`dependencies:
  mine:
    local: ./skills/mine
  kibana:
    pack: kibana-pack
    repo: "${fx.repo}"
`,
		);

		await expect(freezeCommand(fx.projectDir, "nope", "0.4.0")).rejects.toThrow(/not in/);
		await expect(freezeCommand(fx.projectDir, "mine", "0.4.0")).rejects.toThrow(/local/);
		await expect(freezeCommand(fx.projectDir, "kibana", "0.4.0")).rejects.toThrow(/pack/);
	});

	test("FR8 --dry-run writes nothing", async () => {
		const fx = await installedAtLatest();
		const manifestBefore = await manifestBytes(fx);
		const lockBefore = await lockfileBytes(fx);

		await freezeCommand(fx.projectDir, "stable", "0.4.0", { dryRun: true });

		expect(await manifestBytes(fx)).toBe(manifestBefore);
		expect(await lockfileBytes(fx)).toBe(lockBefore);
		expect(await readRef(repoCachePath(fx.repo), `${FROZEN_REF_PREFIX}0.4.0`)).toBeNull();
	});

	test("FR9 re-freezing after upstream moved the tag takes the new commit", async () => {
		const fx = await installedAtLatest();
		await freezeCommand(fx.projectDir, "stable", "0.4.0");
		await simpleGit(fx.bareDir).raw(["tag", "-f", "v0.4.0", fx.newCommit]);

		await freezeCommand(fx.projectDir, "stable", "0.4.0");

		expect(await readRef(repoCachePath(fx.repo), `${FROZEN_REF_PREFIX}0.4.0`)).toBe(fx.newCommit);
		expect((await readLockfile(fx.projectDir))?.packages.stable?.commit).toBe(fx.newCommit);
		const result = await resolveAll(await readManifest(fx.projectDir), fx.projectDir);
		expect(result.warnings.filter((w) => w.includes("was moved upstream"))).toEqual([]);
	});

	test("FR11 a dev-dependency is frozen in place", async () => {
		const fx = await buildFixture();
		await writeManifestYaml(fx, '    version: "*"\n', "dev-dependencies");
		await installCommand(fx.projectDir, {});

		await freezeCommand(fx.projectDir, "stable", "0.4.0");

		const manifest = await readManifest(fx.projectDir);
		expect(manifest.dependencies?.stable).toBeUndefined();
		const devEntry = manifest["dev-dependencies"]?.stable as { frozen?: string } | undefined;
		expect(devEntry?.frozen).toBe("0.4.0");
	});
});

describe("unfreeze", () => {
	async function frozenAtOld(): Promise<Fixture> {
		const fx = await buildFixture();
		await writeManifestYaml(fx, '    frozen: "0.4.0"\n');
		await installCommand(fx.projectDir, {});
		return fx;
	}

	test("UF1 unfreeze removes frozen and follows the repo's version again", async () => {
		const fx = await frozenAtOld();

		await unfreezeCommand(fx.projectDir, "stable");

		expect("frozen" in (await stableEntry(fx))).toBe(false);
		const locked = (await readLockfile(fx.projectDir))?.packages.stable;
		expect(locked?.version).toBe("0.6.0");
		expect(locked?.frozen).toBeUndefined();
		expect(await installedSkill(fx)).toContain("Updated content for v0.6.0");
	});

	test("UF2 unfreeze on a dep that isn't frozen changes nothing", async () => {
		const fx = await installedAtLatest();
		const manifestBefore = await manifestBytes(fx);
		const lockBefore = await lockfileBytes(fx);

		await unfreezeCommand(fx.projectDir, "stable");

		expect(await manifestBytes(fx)).toBe(manifestBefore);
		expect(await lockfileBytes(fx)).toBe(lockBefore);
	});

	test("UF3 unfreeze on an unknown name is an error", async () => {
		const fx = await frozenAtOld();

		await expect(unfreezeCommand(fx.projectDir, "nope")).rejects.toThrow(/not in/);
	});

	test("UF4 --dry-run writes nothing", async () => {
		const fx = await frozenAtOld();
		const manifestBefore = await manifestBytes(fx);
		const lockBefore = await lockfileBytes(fx);

		await unfreezeCommand(fx.projectDir, "stable", { dryRun: true });

		expect(await manifestBytes(fx)).toBe(manifestBefore);
		expect(await lockfileBytes(fx)).toBe(lockBefore);
	});

	test("UF5 deleting frozen: by hand re-resolves on the next install", async () => {
		const fx = await frozenAtOld();
		await writeManifestYaml(fx, "");

		await installCommand(fx.projectDir, {});

		expect((await readLockfile(fx.projectDir))?.packages.stable?.version).toBe("0.6.0");
	});
});
