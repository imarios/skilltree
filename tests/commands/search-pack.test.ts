import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchCommand } from "../../src/commands/search.js";
import { writeRegistryIndex } from "../../src/core/registry-cache.js";
import { writeConfig } from "../../src/core/registry-config.js";
import type { RegistryIndex } from "../../src/types.js";

let tempDir: string;

async function setup(): Promise<{ dir: string; configPath: string; cacheDir: string }> {
	tempDir = join(
		tmpdir(),
		`skilltree-search-pack-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await mkdir(tempDir, { recursive: true });
	const configPath = join(tempDir, "config.yaml");
	const cacheDir = join(tempDir, "cache");
	await writeConfig(
		{ registries: [{ name: "acme", repo: "github.com/acme/skill-packs" }] },
		configPath,
	);
	const index: RegistryIndex = {
		registry: "acme",
		repo: "github.com/acme/skill-packs",
		updated_at: new Date().toISOString(),
		entities: [
			{
				name: "python-pack",
				type: "skill", // placeholder per packs.md
				path: "pack:python-pack",
				kind: "pack",
				description: "Python development pack",
			},
			{
				name: "regular-skill",
				type: "skill",
				path: "skills/regular-skill",
				description: "An entity, not a pack",
			},
		],
	};
	await writeRegistryIndex(index, cacheDir);
	return { dir: tempDir, configPath, cacheDir };
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("search renders kind=pack entries with `pack` type label", () => {
	test("JSON output preserves the kind field", async () => {
		const { configPath, cacheDir } = await setup();
		const lines: string[] = [];
		const origLog = console.log;
		console.log = (...args: unknown[]) => {
			lines.push(args.map(String).join(" "));
		};
		try {
			await searchCommand("python", { json: true }, configPath, cacheDir);
		} finally {
			console.log = origLog;
		}
		const parsed = JSON.parse(lines.join("\n")) as Array<{ name: string; kind?: string }>;
		const packEntry = parsed.find((p) => p.name === "python-pack");
		expect(packEntry?.kind).toBe("pack");
	});

	test("human output labels packs as `pack`, not `skill`", async () => {
		const { configPath, cacheDir } = await setup();
		const lines: string[] = [];
		const origLog = console.log;
		console.log = (...args: unknown[]) => {
			lines.push(args.map(String).join(" "));
		};
		try {
			await searchCommand("python", {}, configPath, cacheDir);
		} finally {
			console.log = origLog;
		}
		// Strip ANSI to make assertions robust.
		const ansiRe = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
		const text = lines.join("\n").replace(ansiRe, "");
		// The pack entry's row should display "pack" as its type, not "skill".
		const packLine = text.split("\n").find((l) => l.includes("python-pack"));
		expect(packLine).toBeDefined();
		expect(packLine).toMatch(/\bpack\b/);
		// And it must NOT contain "skill" in the type column for the pack row.
		// Allowed: it may appear inside "python-pack" as part of "pack". We
		// search for whole-word "skill" with non-word boundaries.
		expect(/\bskill\b/.test(packLine ?? "")).toBe(false);
	});

	test("human output suggests `--pack` install command, not --path with sentinel", async () => {
		const { configPath, cacheDir } = await setup();
		const lines: string[] = [];
		const origLog = console.log;
		console.log = (...args: unknown[]) => {
			lines.push(args.map(String).join(" "));
		};
		try {
			await searchCommand("python", {}, configPath, cacheDir);
		} finally {
			console.log = origLog;
		}
		const ansiRe = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
		const text = lines.join("\n").replace(ansiRe, "");
		// For the pack entry, the install hint should use --pack and not contain
		// the internal sentinel `pack:python-pack` from the index entry's path.
		const packHint = text.split("\n").find((l) => l.includes("python-pack") && l.includes("add"));
		expect(packHint).toBeDefined();
		expect(packHint).toMatch(/--pack\b/);
		expect(packHint).not.toMatch(/--path\s+pack:/);
	});
});
