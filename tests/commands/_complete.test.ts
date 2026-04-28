import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeCommand, getSuggestions, isCompleteKind } from "../../src/commands/_complete.js";

let tempDir: string | undefined;

async function makeProjectDir(yaml: string): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-complete-"));
	await writeFile(join(tempDir, "skilltree.yaml"), yaml, "utf-8");
	return tempDir;
}

async function makeGlobalDir(yaml: string): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-complete-global-"));
	await mkdir(tempDir, { recursive: true });
	await writeFile(join(tempDir, "global.yaml"), yaml, "utf-8");
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

describe("_complete: getSuggestions", () => {
	describe("deps", () => {
		test("returns sorted dep names from project manifest", async () => {
			const dir = await makeProjectDir(
				`dependencies:\n  zebra:\n    local: ./skills/zebra\n  apple:\n    local: ./skills/apple\n`,
			);
			const result = await getSuggestions("deps", { dir });
			expect(result).toEqual(["apple", "zebra"]);
		});

		test("merges prod and dev dependencies, deduped", async () => {
			const dir = await makeProjectDir(
				`dependencies:\n  prod-skill:\n    local: ./p\ndev-dependencies:\n  dev-skill:\n    local: ./d\n`,
			);
			const result = await getSuggestions("deps", { dir });
			expect(result).toEqual(["dev-skill", "prod-skill"]);
		});

		test("returns [] when no manifest exists (silent failure)", async () => {
			const dir = await mkdtemp(join(tmpdir(), "skilltree-complete-empty-"));
			tempDir = dir;
			const result = await getSuggestions("deps", { dir });
			expect(result).toEqual([]);
		});

		test("returns [] on malformed manifest (never breaks the shell)", async () => {
			const dir = await makeProjectDir("dependencies: this is not: valid: [yaml");
			const result = await getSuggestions("deps", { dir });
			expect(result).toEqual([]);
		});

		test("reads global manifest when global=true", async () => {
			const globalDir = await makeGlobalDir(
				`dependencies:\n  global-skill:\n    local: ~/skills/g\n`,
			);
			const result = await getSuggestions("deps", { global: true, globalDir });
			expect(result).toEqual(["global-skill"]);
		});
	});

	describe("targets", () => {
		test("returns install_targets sorted", async () => {
			const dir = await makeProjectDir(
				`install_targets:\n  - cursor\n  - claude\n  - ./custom\ndependencies: {}\n`,
			);
			const result = await getSuggestions("targets", { dir });
			expect(result).toEqual(["./custom", "claude", "cursor"]);
		});

		test("returns [] when install_targets unset", async () => {
			const dir = await makeProjectDir(`dependencies: {}\n`);
			const result = await getSuggestions("targets", { dir });
			expect(result).toEqual([]);
		});
	});

	describe("agents", () => {
		test("returns the built-in agent registry keys", async () => {
			const result = await getSuggestions("agents");
			// Don't hard-code the full list (it'll change); just sanity check.
			expect(result).toContain("claude");
			expect(result).toContain("cursor");
			expect(result.length).toBeGreaterThanOrEqual(3);
			// Sorted
			expect([...result].sort()).toEqual(result);
		});

		test("works regardless of cwd / manifest presence", async () => {
			// No tempDir set up — this should still succeed.
			const result = await getSuggestions("agents");
			expect(result.length).toBeGreaterThan(0);
		});
	});

	// Regression: the boundary used to cast `kind: string` straight into the
	// typed kind, then rely on the switch having no default to throw via
	// "undefined.length". `completeCommand` now validates explicitly so an
	// unknown kind is silent — never throws, never prints.
	describe("unknown kinds", () => {
		test("isCompleteKind rejects unknown values", () => {
			expect(isCompleteKind("deps")).toBe(true);
			expect(isCompleteKind("targets")).toBe(true);
			expect(isCompleteKind("agents")).toBe(true);
			expect(isCompleteKind("bogus")).toBe(false);
			expect(isCompleteKind("")).toBe(false);
		});

		test("completeCommand silently ignores unknown kinds (no throw, no output)", async () => {
			const writes: string[] = [];
			const orig = process.stdout.write;
			// Cast through unknown to satisfy the strict signature; we are
			// intentionally testing the runtime guard, not the type.
			(process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
				writes.push(s);
				return true;
			};
			try {
				await completeCommand("not-a-kind");
			} finally {
				process.stdout.write = orig;
			}
			expect(writes).toEqual([]);
		});
	});
});
