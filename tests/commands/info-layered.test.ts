/**
 * Tests for #75: `skilltree info` should fall through to lockfile/manifest for
 * installed deps before consulting registries.
 *
 * Resolution order:
 *   1. lockfile (most authoritative — installed, with commit + integrity)
 *   2. manifest (declared but maybe not yet installed)
 *   3. configured registries
 *
 * The "No registries configured" precondition is no longer top-of-function;
 * it only fires when the dep also isn't locally resolvable.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { infoCommand } from "../../src/commands/info.js";
import { writeLockfile } from "../../src/core/lockfile.js";
import { writeManifest } from "../../src/core/manifest.js";
import { writeRegistryIndex } from "../../src/core/registry-cache.js";
import { writeConfig } from "../../src/core/registry-config.js";
import type { Lockfile, Manifest, RegistryIndex } from "../../src/types.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(tmpdir(), `skilltree-info75-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	await mkdir(tempDir, { recursive: true });
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

function captureLogs(): { logs: string[]; restore: () => void } {
	const logs: string[] = [];
	const orig = console.log;
	console.log = (...args: unknown[]) => logs.push(args.join(" "));
	return {
		logs,
		restore: () => {
			console.log = orig;
		},
	};
}

async function writeProjectManifest(dir: string, manifest: Manifest): Promise<void> {
	await writeManifest(dir, manifest);
}

async function writeProjectLockfile(dir: string, lockfile: Lockfile): Promise<void> {
	await writeLockfile(dir, lockfile);
}

describe("#75: info falls through to lockfile/manifest", () => {
	test("installed dep with NO registries configured succeeds with [lockfile] block", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const cacheDir = join(dir, "cache");

		// No registries configured at all
		await writeConfig({ registries: [] }, configPath);

		// But the dep IS installed (lockfile + manifest)
		await writeProjectManifest(dir, {
			dependencies: {
				"skill-creator": {
					repo: "github.com/anthropics/skills",
					path: "skills/skill-creator",
				},
			},
		});
		await writeProjectLockfile(dir, {
			lockfile_version: 1,
			packages: {
				"skill-creator": {
					type: "skill",
					group: "prod",
					repo: "github.com/anthropics/skills",
					path: "skills/skill-creator",
					commit: "abc1234",
					integrity: "sha256-deadbeef",
					dependencies: [],
				},
			},
		});

		const cap = captureLogs();
		try {
			// Must NOT throw — old behavior threw "No registries configured"
			await infoCommand("skill-creator", { dir }, configPath, cacheDir);
		} finally {
			cap.restore();
		}
		const output = cap.logs.join("\n");
		expect(output).toContain("[lockfile]");
		expect(output).toContain("skill-creator");
		expect(output).toContain("abc1234");
	});

	test("--json on installed dep with no registries returns lockfile-tagged entry", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const cacheDir = join(dir, "cache");
		await writeConfig({ registries: [] }, configPath);

		await writeProjectLockfile(dir, {
			lockfile_version: 1,
			packages: {
				"skill-creator": {
					type: "skill",
					group: "prod",
					repo: "github.com/anthropics/skills",
					path: "skills/skill-creator",
					commit: "abc1234",
					version: "1.2.3",
					integrity: "sha256-deadbeef",
					dependencies: [],
				},
			},
		});

		const cap = captureLogs();
		try {
			await infoCommand("skill-creator", { json: true, dir }, configPath, cacheDir);
		} finally {
			cap.restore();
		}
		const parsed = JSON.parse(cap.logs.join("\n")) as Array<Record<string, unknown>>;
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed.length).toBe(1);
		expect(parsed[0]?.layer).toBe("lockfile");
		expect(parsed[0]?.name).toBe("skill-creator");
		expect(parsed[0]?.version).toBe("1.2.3");
		expect(parsed[0]?.commit).toBe("abc1234");
	});

	test("dep declared in manifest but not yet installed shows [manifest] block", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const cacheDir = join(dir, "cache");
		await writeConfig({ registries: [] }, configPath);

		// Manifest declares it, but no lockfile yet
		await writeProjectManifest(dir, {
			dependencies: {
				"some-skill": {
					repo: "github.com/x/y",
					path: "skills/some-skill",
					version: "^2.0.0",
				},
			},
		});

		const cap = captureLogs();
		try {
			await infoCommand("some-skill", { dir }, configPath, cacheDir);
		} finally {
			cap.restore();
		}
		const output = cap.logs.join("\n");
		expect(output).toContain("[manifest]");
		expect(output).toContain("some-skill");
		expect(output).toContain("^2.0.0");
		// No lockfile section — it isn't installed
		expect(output).not.toContain("[lockfile]");
	});

	test("dep in lockfile AND registry shows both sections", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const cacheDir = join(dir, "cache");
		await writeConfig({ registries: [{ name: "main", repo: "github.com/x/y" }] }, configPath);

		const index: RegistryIndex = {
			registry: "main",
			repo: "github.com/x/y",
			updated_at: new Date().toISOString(),
			scanner_version: 1,
			entities: [
				{
					name: "skill-creator",
					type: "skill",
					path: "skills/skill-creator",
					description: "Generates SKILL.md scaffolds",
				},
			],
		};
		await writeRegistryIndex(index, cacheDir);

		await writeProjectLockfile(dir, {
			lockfile_version: 1,
			packages: {
				"skill-creator": {
					type: "skill",
					group: "prod",
					repo: "github.com/anthropics/skills",
					path: "skills/skill-creator",
					commit: "abc1234",
					dependencies: [],
				},
			},
		});

		const cap = captureLogs();
		try {
			await infoCommand("skill-creator", { dir }, configPath, cacheDir);
		} finally {
			cap.restore();
		}
		const output = cap.logs.join("\n");
		expect(output).toContain("[lockfile]");
		expect(output).toContain("[registry: main]");
		// Lockfile section comes first (most authoritative)
		const lockIdx = output.indexOf("[lockfile]");
		const regIdx = output.indexOf("[registry: main]");
		expect(lockIdx).toBeLessThan(regIdx);
	});

	test("found nowhere throws unified error mentioning all three layers", async () => {
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const cacheDir = join(dir, "cache");
		await writeConfig({ registries: [{ name: "r", repo: "x" }] }, configPath);
		const index: RegistryIndex = {
			registry: "r",
			repo: "x",
			updated_at: new Date().toISOString(),
			scanner_version: 1,
			entities: [],
		};
		await writeRegistryIndex(index, cacheDir);

		await expect(infoCommand("nonexistent", { dir }, configPath, cacheDir)).rejects.toThrow(
			/not found.*lockfile.*manifest.*registr/i,
		);
	});

	test("--json with installed-only dep does NOT throw 'No registries configured'", async () => {
		// Belt-and-suspenders: the round-3 spec explicitly calls out that the
		// line-33 precondition must move to after the local check.
		const dir = await setup();
		const configPath = join(dir, "config.yaml");
		const cacheDir = join(dir, "cache");
		await writeConfig({ registries: [] }, configPath);
		await writeProjectLockfile(dir, {
			lockfile_version: 1,
			packages: {
				"skill-creator": {
					type: "skill",
					group: "prod",
					repo: "github.com/anthropics/skills",
					path: "skills/skill-creator",
					commit: "abc1234",
					dependencies: [],
				},
			},
		});
		const cap = captureLogs();
		try {
			await infoCommand("skill-creator", { json: true, dir }, configPath, cacheDir);
		} finally {
			cap.restore();
		}
		// Should have output, not thrown
		expect(cap.logs.join("\n")).toContain("lockfile");
	});
});
