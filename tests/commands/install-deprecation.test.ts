/**
 * Regression tests for legacy install-path deprecation warnings.
 *
 * Background: `warnLegacyInstallPath` lives outside `getInstallTargets` so the
 * warning fires even in `--dry-run` and `--frozen` modes (which short-circuit
 * before the code paths that previously called `getInstallTargets`).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand } from "../../src/commands/install.js";
import { removeCommand } from "../../src/commands/remove.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-depr-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

/** Capture console.warn output during fn(). */
async function captureWarn(fn: () => Promise<void>): Promise<string[]> {
	const warns: string[] = [];
	const original = console.warn;
	console.warn = (...args: unknown[]) => warns.push(args.join(" "));
	try {
		await fn();
	} finally {
		console.warn = original;
	}
	return warns;
}

const LEGACY_MANIFEST =
	"dev_install_path: .claude\ndependencies:\n  my-skill:\n    local: ./skills/my-skill\n";

async function writeManifest(dir: string, content: string): Promise<void> {
	await writeFile(join(dir, "skilltree.yml"), content, "utf-8");
}

describe("dev_install_path deprecation warning", () => {
	test("emits warning in normal install mode", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeManifest(dir, LEGACY_MANIFEST);

		const warns = await captureWarn(() => installCommand(dir, {}));
		expect(warns.some((w) => w.includes("deprecated"))).toBe(true);
	});

	test("emits warning in --dry-run mode", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeManifest(dir, LEGACY_MANIFEST);

		const warns = await captureWarn(() => installCommand(dir, { dryRun: true }));
		expect(warns.some((w) => w.includes("deprecated"))).toBe(true);
	});

	test("emits warning in --frozen mode", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeManifest(dir, LEGACY_MANIFEST);

		// First do a normal install to produce a lockfile.
		await installCommand(dir, {});

		const warns = await captureWarn(() => installCommand(dir, { frozen: true }));
		expect(warns.some((w) => w.includes("deprecated"))).toBe(true);
	});

	test("emits warning when removing from a project with legacy field", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeManifest(dir, LEGACY_MANIFEST);

		// Install first so there's something to remove.
		await installCommand(dir, {});

		const warns = await captureWarn(() => removeCommand("my-skill", dir, { force: true }));
		expect(warns.some((w) => w.includes("deprecated"))).toBe(true);
	});
});

describe("global manifest rejects legacy install-path fields", () => {
	test("validateGlobalManifest reports dev_install_path", async () => {
		const { validateGlobalManifest, parseManifest } = await import("../../src/core/manifest.js");
		const m = parseManifest("dev_install_path: .claude\ndependencies: {}\n");
		const errors = validateGlobalManifest(m);
		expect(errors.some((e) => e.includes("dev_install_path"))).toBe(true);
	});

	test("validateGlobalManifest reports install_path", async () => {
		const { validateGlobalManifest, parseManifest } = await import("../../src/core/manifest.js");
		const m = parseManifest("install_path: .claude\ndependencies: {}\n");
		const errors = validateGlobalManifest(m);
		expect(errors.some((e) => e.includes("install_path"))).toBe(true);
	});

	test("removeCommand --global rejects legacy global manifest", async () => {
		const dir = await makeTempDir();
		const globalDir = join(dir, "global-config");
		const { mkdir } = await import("node:fs/promises");
		await mkdir(globalDir, { recursive: true });
		// Legacy global manifest: dev_install_path with no install_targets,
		// plus one dependency so removeCommand has a candidate to look at.
		await writeFile(
			join(globalDir, "global.yaml"),
			"dev_install_path: .claude\ndependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
			"utf-8",
		);

		await expect(
			removeCommand("my-skill", dir, { global: true, globalDir, force: true }),
		).rejects.toThrow("Global manifest validation failed");
	});
});
