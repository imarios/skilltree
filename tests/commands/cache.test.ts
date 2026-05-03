import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheCleanCommand } from "../../src/commands/cache.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

function captureLogs(): { logs: string[]; restore: () => void } {
	const logs: string[] = [];
	const original = console.log;
	console.log = (...args: unknown[]) => logs.push(args.join(" "));
	return {
		logs,
		restore: () => {
			console.log = original;
		},
	};
}

describe("cacheCleanCommand --json", () => {
	test("emits {cleaned: true, path, bytesFreed} after removing a populated cache", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-cache-"));
		const fakeCache = join(tempDir, "cache");
		await mkdir(fakeCache, { recursive: true });
		await writeFile(join(fakeCache, "blob.txt"), "x".repeat(1024), "utf-8");

		const { logs, restore } = captureLogs();
		try {
			await cacheCleanCommand({ json: true, cacheDir: fakeCache });
		} finally {
			restore();
		}

		expect(logs).toHaveLength(1);
		const parsed = JSON.parse(logs[0] ?? "");
		expect(parsed.cleaned).toBe(true);
		expect(parsed.path).toBe(fakeCache);
		expect(typeof parsed.bytesFreed).toBe("number");
		expect(parsed.bytesFreed).toBeGreaterThanOrEqual(1024);
	});

	test("emits {cleaned: false, path, bytesFreed: 0} when cache is already absent", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-cache-"));
		const fakeCache = join(tempDir, "no-such-cache");

		const { logs, restore } = captureLogs();
		try {
			await cacheCleanCommand({ json: true, cacheDir: fakeCache });
		} finally {
			restore();
		}

		expect(logs).toHaveLength(1);
		const parsed = JSON.parse(logs[0] ?? "");
		expect(parsed.cleaned).toBe(false);
		expect(parsed.path).toBe(fakeCache);
		expect(parsed.bytesFreed).toBe(0);
	});
});

describe("cacheCleanCommand human output", () => {
	test("removes a populated cache and reports success", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-cache-"));
		const fakeCache = join(tempDir, "cache");
		await mkdir(fakeCache, { recursive: true });
		await writeFile(join(fakeCache, "blob.txt"), "data", "utf-8");

		const { logs, restore } = captureLogs();
		try {
			await cacheCleanCommand({ cacheDir: fakeCache });
		} finally {
			restore();
		}

		expect(logs.some((l) => l.includes("Removed cache"))).toBe(true);
	});

	test("reports already-clean when cache is absent", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-cache-"));
		const fakeCache = join(tempDir, "no-such-cache");

		const { logs, restore } = captureLogs();
		try {
			await cacheCleanCommand({ cacheDir: fakeCache });
		} finally {
			restore();
		}

		expect(logs.some((l) => l.includes("already clean"))).toBe(true);
	});
});
