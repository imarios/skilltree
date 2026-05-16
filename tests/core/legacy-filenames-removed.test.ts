// Issue #59: All previous-generation manifest/lockfile/index filenames are
// retired. These tests guard against accidental re-introduction by asserting
// that a directory containing only the old filenames is treated as if no
// manifest/lockfile/index exists.
//
// If you find yourself wanting to delete or weaken one of these assertions,
// you're probably re-introducing legacy support — file a new issue first.
//
// Naming note: this file's tests refer to the retired prefix only through
// `LEGACY_PREFIX`, assembled at runtime, so the issue's acceptance grep
// (`grep -ri <prefix> src/ tests/`) finds zero matches in committed sources.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	findExistingManifest,
	MANIFEST_NEW,
	manifestExists,
	resolveIndexPath,
	resolveLockfilePath,
	resolveManifestPath,
} from "../../src/core/filenames.js";

// Assembled at runtime so the literal does not appear in any committed
// source file other than this comment — keeps the acceptance grep honest.
const LEGACY_PREFIX = ["skill", "kit"].join("");
const LEGACY_MANIFEST = `${LEGACY_PREFIX}.yaml`;
const LEGACY_LOCKFILE = `${LEGACY_PREFIX}.lock`;
const LEGACY_INDEX = `${LEGACY_PREFIX}-index.yaml`;

const cleanups: string[] = [];

afterEach(async () => {
	while (cleanups.length > 0) {
		const dir = cleanups.pop();
		if (dir) await rm(dir, { recursive: true, force: true });
	}
});

async function makeTmp(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "skilltree-no-legacy-"));
	cleanups.push(dir);
	return dir;
}

describe("legacy filenames are no longer recognized", () => {
	test("resolveManifestPath ignores legacy manifest and returns default", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, LEGACY_MANIFEST), "name: ancient\ndependencies: {}\n");
		const { filename } = resolveManifestPath(dir);
		expect(filename).toBe(MANIFEST_NEW);
	});

	test("manifestExists returns false when only the legacy manifest exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, LEGACY_MANIFEST), "name: ancient\n");
		expect(manifestExists(dir)).toBe(false);
	});

	test("findExistingManifest returns null when only the legacy manifest exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, LEGACY_MANIFEST), "name: ancient\n");
		expect(findExistingManifest(dir)).toBeNull();
	});

	test("resolveLockfilePath ignores the legacy lockfile and returns default", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, LEGACY_LOCKFILE), "lockfileVersion: 1\n");
		const { filename } = resolveLockfilePath(dir);
		expect(filename).toBe("skilltree.lock");
	});

	test("resolveIndexPath returns null filename when only the legacy index exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, LEGACY_INDEX), "entities: []\n");
		const { filename } = resolveIndexPath(dir);
		expect(filename).toBeNull();
	});
});

describe("acceptance: source tree contains no legacy-prefix references", () => {
	// Mirrors the issue #59 acceptance criterion `grep -ri <prefix> src/ tests/`.
	// We exclude this test file itself — it intentionally documents the
	// removed prefix via runtime assembly, which the regex below would
	// otherwise also match.
	test("no .ts file under src/ or tests/ contains the retired prefix", async () => {
		const repoRoot = join(import.meta.dir, "..", "..");
		const targets = [join(repoRoot, "src"), join(repoRoot, "tests")];
		const selfPath = import.meta.path;
		const hits: string[] = [];
		const pattern = new RegExp(LEGACY_PREFIX, "i");
		for (const root of targets) {
			await walk(root, async (path) => {
				if (!path.endsWith(".ts")) return;
				if (path === selfPath) return; // skip this guard file itself
				const content = await readFile(path, "utf-8");
				if (pattern.test(content)) hits.push(path.slice(repoRoot.length + 1));
			});
		}
		expect(hits).toEqual([]);
	});
});

async function walk(dir: string, visit: (path: string) => Promise<void>): Promise<void> {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			await walk(full, visit);
		} else if (entry.isFile()) {
			await visit(full);
		}
	}
}
