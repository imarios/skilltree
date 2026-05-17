import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCommand } from "../../src/commands/init.js";
import { readManifest } from "../../src/core/manifest.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-init-agents-"));
	return tempDir;
}

async function makeHomeWith(dir: string, agents: string[]): Promise<string> {
	const fakeHome = join(dir, `home-${agents.join("-") || "empty"}`);
	await mkdir(fakeHome, { recursive: true });
	for (const a of agents) {
		// detectDir for codex/copilot differs from the dir we install into.
		const detectDir = a === "codex" ? ".codex" : a === "copilot" ? ".copilot" : `.${a}`;
		await mkdir(join(fakeHome, detectDir), { recursive: true });
	}
	return fakeHome;
}

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("init auto-detection", () => {
	test("single detected agent: enrolled without prompting (no askFn called)", async () => {
		// Single-agent case is unambiguous — never bother the user. Spec issue #74.
		const dir = await makeTempDir();
		const fakeHome = await makeHomeWith(dir, ["claude"]);

		let promptCalls = 0;
		await initCommand(dir, {
			homeDir: fakeHome,
			askFn: async () => {
				promptCalls++;
				return "y";
			},
			isInteractive: true,
		});

		expect(promptCalls).toBe(0);
		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toEqual(["claude"]);
	});

	test("multiple detected agents + --yes: includes all (opt-in current behaviour)", async () => {
		const dir = await makeTempDir();
		const fakeHome = await makeHomeWith(dir, ["claude", "codex"]);

		await initCommand(dir, { homeDir: fakeHome, yes: true });

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toContain("claude");
		expect(manifest.install_targets).toContain("codex");
	});

	test("multiple detected agents, non-interactive, no --yes: defaults to [claude] only", async () => {
		// CI-safe default. Issue #74: detection must not equal enrolment.
		const dir = await makeTempDir();
		const fakeHome = await makeHomeWith(dir, ["claude", "codex", "cursor"]);

		await initCommand(dir, { homeDir: fakeHome, isInteractive: false });

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toEqual(["claude"]);
	});

	test("multiple detected agents + askFn 'y': includes all", async () => {
		const dir = await makeTempDir();
		const fakeHome = await makeHomeWith(dir, ["claude", "codex"]);

		let question = "";
		await initCommand(dir, {
			homeDir: fakeHome,
			isInteractive: true,
			askFn: async (q) => {
				question = q;
				return "y";
			},
		});

		expect(question).toContain("Include all?");
		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toContain("claude");
		expect(manifest.install_targets).toContain("codex");
	});

	test("multiple detected agents + askFn picks subset by index", async () => {
		const dir = await makeTempDir();
		const fakeHome = await makeHomeWith(dir, ["claude", "codex", "cursor"]);

		await initCommand(dir, {
			homeDir: fakeHome,
			isInteractive: true,
			// Detected list is sorted; assume "claude, codex, cursor" → pick 1,3
			askFn: async () => "1,3",
		});

		const manifest = await readManifest(dir);
		// Pick #1 (claude) and #3 (cursor); codex (#2) excluded.
		expect(manifest.install_targets).toContain("claude");
		expect(manifest.install_targets).toContain("cursor");
		expect(manifest.install_targets).not.toContain("codex");
	});

	test("multiple detected agents + askFn 'n': falls back to [claude]", async () => {
		// "None" is meaningless for install_targets (must have at least one). Falls
		// back to the safe default rather than producing an unusable empty list.
		const dir = await makeTempDir();
		const fakeHome = await makeHomeWith(dir, ["claude", "codex"]);

		await initCommand(dir, {
			homeDir: fakeHome,
			isInteractive: true,
			askFn: async () => "n",
		});

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toEqual(["claude"]);
	});

	test("--target bypasses detection entirely (single)", async () => {
		const dir = await makeTempDir();
		// Home has claude+codex; --target should override and pick only what was asked.
		const fakeHome = await makeHomeWith(dir, ["claude", "codex"]);

		let promptCalls = 0;
		await initCommand(dir, {
			homeDir: fakeHome,
			targets: ["codex"],
			isInteractive: true,
			askFn: async () => {
				promptCalls++;
				return "y";
			},
		});

		expect(promptCalls).toBe(0);
		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toEqual(["codex"]);
	});

	test("--target rejects unknown bare words (parity with `targets add`)", async () => {
		// Fail fast — otherwise garbage lands in install_targets and breaks at install time.
		const dir = await makeTempDir();
		const fakeHome = await makeHomeWith(dir, []);

		await expect(initCommand(dir, { homeDir: fakeHome, targets: ["bogus-agent"] })).rejects.toThrow(
			/unknown agent/,
		);
	});

	test("--target dedupes repeated values", async () => {
		const dir = await makeTempDir();
		const fakeHome = await makeHomeWith(dir, []);

		await initCommand(dir, {
			homeDir: fakeHome,
			targets: ["claude", "codex", "claude"],
		});

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toEqual(["claude", "codex"]);
	});

	test("--target bypasses detection entirely (multiple)", async () => {
		const dir = await makeTempDir();
		const fakeHome = await makeHomeWith(dir, []);

		await initCommand(dir, {
			homeDir: fakeHome,
			targets: ["claude", "codex"],
			isInteractive: false,
		});

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toEqual(["claude", "codex"]);
	});

	test("falls back to [claude] when no agents detected", async () => {
		const dir = await makeTempDir();
		const fakeHome = await makeHomeWith(dir, []);

		await initCommand(dir, { homeDir: fakeHome });

		const manifest = await readManifest(dir);
		expect(manifest.install_targets).toEqual(["claude"]);
		expect(manifest.dev_install_path).toBeUndefined();
	});

	test("re-run on existing project: error message suggests `targets add` / `targets detect`", async () => {
		// Friction A from issue #74: the old "Remove it first or edit it directly"
		// hint was wrong — the actual right commands are targets add / targets detect.
		const dir = await makeTempDir();
		const fakeHome = await makeHomeWith(dir, []);
		await initCommand(dir, { homeDir: fakeHome });

		await expect(initCommand(dir, { homeDir: fakeHome })).rejects.toThrow(/skilltree targets add/);
		await expect(initCommand(dir, { homeDir: fakeHome })).rejects.toThrow(
			/skilltree targets detect/,
		);
	});
});
