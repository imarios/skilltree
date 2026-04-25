import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	GLOBAL_MANIFEST,
	globalManifestExists,
	MANIFEST_LEGACY,
	MANIFEST_NEW,
	manifestExists,
	resolveGlobalManifestPath,
	resolveManifestPath,
} from "../../src/core/filenames.js";

const cleanups: string[] = [];

afterEach(async () => {
	while (cleanups.length > 0) {
		const dir = cleanups.pop();
		if (dir) await rm(dir, { recursive: true, force: true });
	}
});

async function makeTmp(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "skilltree-filenames-"));
	cleanups.push(dir);
	return dir;
}

describe("resolveManifestPath — .yaml / .yml support", () => {
	test("returns skilltree.yaml when only .yaml exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skilltree.yaml"), "");
		const { path, filename } = resolveManifestPath(dir);
		expect(filename).toBe("skilltree.yaml");
		expect(path).toBe(join(dir, "skilltree.yaml"));
	});

	test("returns skilltree.yml when only .yml exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skilltree.yml"), "");
		const { path, filename } = resolveManifestPath(dir);
		expect(filename).toBe("skilltree.yml");
		expect(path).toBe(join(dir, "skilltree.yml"));
	});

	test("throws when both skilltree.yaml and skilltree.yml exist", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skilltree.yaml"), "");
		await writeFile(join(dir, "skilltree.yml"), "");
		expect(() => resolveManifestPath(dir)).toThrow(/both .* exist/i);
	});

	test("returns default skilltree.yaml when neither exists", async () => {
		const dir = await makeTmp();
		const { path, filename } = resolveManifestPath(dir);
		expect(filename).toBe(MANIFEST_NEW);
		expect(path).toBe(join(dir, MANIFEST_NEW));
	});

	test("falls back to skillkit.yaml legacy when no skilltree.* exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skillkit.yaml"), "");
		const { filename } = resolveManifestPath(dir);
		expect(filename).toBe(MANIFEST_LEGACY);
	});

	test("prefers skilltree.yaml over legacy skillkit.yaml when both exist", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skilltree.yaml"), "");
		await writeFile(join(dir, "skillkit.yaml"), "");
		const { filename } = resolveManifestPath(dir);
		expect(filename).toBe(MANIFEST_NEW);
	});

	test("prefers skilltree.yml over legacy skillkit.yaml when only .yml + legacy exist", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skilltree.yml"), "");
		await writeFile(join(dir, "skillkit.yaml"), "");
		const { filename } = resolveManifestPath(dir);
		expect(filename).toBe("skilltree.yml");
	});
});

describe("manifestExists — .yaml / .yml support", () => {
	test("true when skilltree.yaml exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skilltree.yaml"), "");
		expect(manifestExists(dir)).toBe(true);
	});

	test("true when skilltree.yml exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skilltree.yml"), "");
		expect(manifestExists(dir)).toBe(true);
	});

	test("true when only legacy skillkit.yaml exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skillkit.yaml"), "");
		expect(manifestExists(dir)).toBe(true);
	});

	test("false when no manifest exists", async () => {
		const dir = await makeTmp();
		expect(manifestExists(dir)).toBe(false);
	});
});

describe("resolveGlobalManifestPath — .yaml / .yml support", () => {
	test("returns global.yaml when only .yaml exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "global.yaml"), "");
		const { filename } = resolveGlobalManifestPath(dir);
		expect(filename).toBe("global.yaml");
	});

	test("returns global.yml when only .yml exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "global.yml"), "");
		const { filename } = resolveGlobalManifestPath(dir);
		expect(filename).toBe("global.yml");
	});

	test("throws when both global.yaml and global.yml exist", async () => {
		const dir = await makeTmp();
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "global.yaml"), "");
		await writeFile(join(dir, "global.yml"), "");
		expect(() => resolveGlobalManifestPath(dir)).toThrow(/both .* exist/i);
	});

	test("returns default global.yaml when neither exists", async () => {
		const dir = await makeTmp();
		const { filename } = resolveGlobalManifestPath(dir);
		expect(filename).toBe(GLOBAL_MANIFEST);
	});
});

describe("globalManifestExists — .yaml / .yml support", () => {
	test("true when global.yaml exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "global.yaml"), "");
		expect(globalManifestExists(dir)).toBe(true);
	});

	test("true when global.yml exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "global.yml"), "");
		expect(globalManifestExists(dir)).toBe(true);
	});

	test("false when none exist", async () => {
		const dir = await makeTmp();
		expect(globalManifestExists(dir)).toBe(false);
	});
});
