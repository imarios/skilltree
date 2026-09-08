// Tests for doctor's `install-drift` check (#187).
//
// `doctor` aggregated every other health signal but never looked at the
// installed files, so a checkout whose `.claude/` had been deleted or
// tampered with reported a clean bill of health while `verify` reported
// MISSING. These tests use a real install rather than a synthetic lockfile,
// because the thing under test is the relationship between the lockfile and
// what is actually on disk.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../../src/commands/doctor.js";
import { installCommand } from "../../src/commands/install.js";
import { vendorCommand } from "../../src/commands/vendor.js";
import type { CheckResult } from "../../src/types.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

let isolatedHome: string | undefined;
afterAll(async () => {
	if (isolatedHome) await rm(isolatedHome, { recursive: true, force: true });
});

/**
 * Run `doctor` without touching the network, the developer's registries
 * config, or their real `$HOME` — same isolation the main doctor suite uses.
 */
async function driftCheck(
	dir: string,
	opts: Parameters<typeof runDoctor>[1] = {},
): Promise<CheckResult | undefined> {
	if (!isolatedHome) isolatedHome = await mkdtemp(join(tmpdir(), "skilltree-drift-home-"));
	const cfgPath = join(dir, "registries.yaml");
	await writeFile(cfgPath, "registries: []\n", "utf-8");
	const report = await runDoctor(dir, {
		probe: async () => ({ ok: true }),
		registryConfigPath: cfgPath,
		homeDir: isolatedHome,
		...opts,
	});
	return report.checks.find((c) => c.name === "install-drift");
}

async function installedProject(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-drift-"));
	await createLocalSkill(join(tempDir, "skills"), "my-skill");
	await writeFile(
		join(tempDir, "skilltree.yml"),
		"dependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		"utf-8",
	);
	await installCommand(tempDir, {});
	return tempDir;
}

describe("doctor install-drift (#187)", () => {
	test("passes on a clean install", async () => {
		const check = await driftCheck(await installedProject());

		expect(check?.status).toBe("pass");
	});

	test("fails when an installed entity is missing", async () => {
		const dir = await installedProject();
		await rm(join(dir, ".claude", "skills", "my-skill"));

		const check = await driftCheck(dir);

		// This is the exact state that reported a clean bill of health before.
		expect(check?.status).toBe("fail");
		expect(check?.detail).toContain("missing");
		expect(check?.detail).toContain("my-skill");
		expect(check?.fix).toBeDefined();
	});

	test("fails when an installed entity was modified", async () => {
		const dir = await installedProject();
		await vendorCommand(dir, {});
		const skillMd = join(dir, ".claude", "skills", "my-skill", "SKILL.md");
		await chmod(skillMd, 0o644);
		await writeFile(skillMd, "---\nname: my-skill\n---\n\n# Tampered\n");

		const check = await driftCheck(dir);

		expect(check?.status).toBe("fail");
		expect(check?.detail).toContain("modified");
	});

	test("a drifted install makes the whole report fail", async () => {
		const dir = await installedProject();
		await rm(join(dir, ".claude", "skills", "my-skill"));

		if (!isolatedHome) isolatedHome = await mkdtemp(join(tmpdir(), "skilltree-drift-home-"));
		const cfgPath = join(dir, "registries.yaml");
		await writeFile(cfgPath, "registries: []\n", "utf-8");
		const report = await runDoctor(dir, {
			probe: async () => ({ ok: true }),
			registryConfigPath: cfgPath,
			homeDir: isolatedHome,
		});

		// doctorCommand exits 1 on summary.fail > 0 — that's the CI signal.
		expect(report.summary.fail).toBeGreaterThan(0);
	});

	test("skips when there is no lockfile — lockfile-sync already reports that", async () => {
		const dir = await installedProject();
		await rm(join(dir, "skilltree.lock"));

		const check = await driftCheck(dir);

		expect(check?.status).toBe("skip");
	});

	test("passes vacuously with no declared dependencies", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-drift-"));
		await writeFile(join(tempDir, "skilltree.yml"), "dependencies: {}\n", "utf-8");

		const check = await driftCheck(tempDir);

		// Mirrors lockfile-sync's guard (#121): `init && doctor` must not fail.
		expect(check?.status).toBe("pass");
	});

	test("skips in global mode", async () => {
		const dir = await installedProject();
		const globalDir = join(dir, "fake-global");

		const check = await driftCheck(dir, { global: true, globalDir });

		expect(check?.status).toBe("skip");
	});
});
