import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import simpleGit from "simple-git";
import pkg from "../../package.json";
import {
	cleanRegistryCache,
	ensureRegistryRepo,
	getRegistryIndexPath,
	getRegistryRepoDir,
	isCacheCompatible,
	isStale,
	loadFreshRegistryIndex,
	readRegistryIndex,
	SCANNER_VERSION,
	writeRegistryIndex,
} from "../../src/core/registry-cache.js";
import type { RegistryIndex } from "../../src/types.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(
		tmpdir(),
		`skilltree-regcache-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await mkdir(tempDir, { recursive: true });
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("path helpers", () => {
	test("getRegistryRepoDir returns correct path", () => {
		const dir = getRegistryRepoDir("vibes");
		expect(dir).toContain("registry-cache");
		expect(dir).toContain("vibes");
		expect(dir).toEndWith("/repo");
	});

	test("getRegistryIndexPath returns correct path", () => {
		const path = getRegistryIndexPath("vibes");
		expect(path).toContain("registry-cache");
		expect(path).toContain("vibes");
		expect(path).toEndWith("index.json");
	});
});

describe("writeRegistryIndex / readRegistryIndex", () => {
	test("writes valid JSON and reads it back", async () => {
		const dir = await setup();
		const index: RegistryIndex = {
			registry: "vibes",
			repo: "github.com/imarios/vibes",
			updated_at: new Date().toISOString(),
			entities: [
				{
					name: "python-coding",
					type: "skill",
					path: "skills/python-coding",
					description: "Python dev skill",
					tags: ["python", "testing"],
				},
			],
		};
		await writeRegistryIndex(index, dir);
		const readBack = await readRegistryIndex("vibes", dir);
		expect(readBack).not.toBeNull();
		expect(readBack?.registry).toBe("vibes");
		expect(readBack?.entities).toHaveLength(1);
		expect(readBack?.entities[0]?.name).toBe("python-coding");
		expect(readBack?.entities[0]?.tags).toEqual(["python", "testing"]);
	});

	test("readRegistryIndex returns null when index.json does not exist", async () => {
		const dir = await setup();
		const result = await readRegistryIndex("nonexistent", dir);
		expect(result).toBeNull();
	});
});

describe("isStale", () => {
	test("returns true when index does not exist", async () => {
		const dir = await setup();
		const stale = await isStale("nonexistent", undefined, dir);
		expect(stale).toBe(true);
	});

	test("returns false for recent index", async () => {
		const dir = await setup();
		const index: RegistryIndex = {
			registry: "vibes",
			repo: "github.com/imarios/vibes",
			updated_at: new Date().toISOString(),
			entities: [],
		};
		await writeRegistryIndex(index, dir);
		const stale = await isStale("vibes", 24 * 60 * 60 * 1000, dir);
		expect(stale).toBe(false);
	});

	test("returns true for old index", async () => {
		const dir = await setup();
		const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h ago
		const index: RegistryIndex = {
			registry: "vibes",
			repo: "github.com/imarios/vibes",
			updated_at: oldDate.toISOString(),
			entities: [],
		};
		await writeRegistryIndex(index, dir);
		const stale = await isStale("vibes", 24 * 60 * 60 * 1000, dir);
		expect(stale).toBe(true);
	});

	test("returns true when scanner_version is missing (pre-#25 cache)", async () => {
		// Defense in depth: even if the time-based check would say "fresh",
		// a cache produced by a pre-fingerprint build is not safe to consume.
		const dir = await setup();
		const indexPath = getRegistryIndexPath("vibes", dir);
		await mkdir(dirname(indexPath), { recursive: true });
		const raw = {
			registry: "vibes",
			repo: "github.com/imarios/vibes",
			updated_at: new Date().toISOString(),
			entities: [],
		};
		await writeFile(indexPath, JSON.stringify(raw), "utf-8");
		const stale = await isStale("vibes", 24 * 60 * 60 * 1000, dir);
		expect(stale).toBe(true);
	});
});

describe("scanner_version stamping", () => {
	test("writeRegistryIndex stamps the running SCANNER_VERSION and package_version", async () => {
		const dir = await setup();
		// Caller does NOT pass either field — they should be filled in.
		const index: RegistryIndex = {
			registry: "vibes",
			repo: "github.com/imarios/vibes",
			updated_at: new Date().toISOString(),
			entities: [],
		};
		await writeRegistryIndex(index, dir);
		const readBack = await readRegistryIndex("vibes", dir);
		expect(readBack?.scanner_version).toBe(SCANNER_VERSION);
		expect(readBack?.package_version).toBe(pkg.version);
	});

	test("writeRegistryIndex preserves an explicit scanner_version (no clobber on round-trip)", async () => {
		// We never want callers to pin an arbitrary version, but the round-trip
		// of read → write must not lose the field. The current design always
		// stamps the running version, so this test pins that behavior:
		// whatever caller passes is replaced by the running constant.
		const dir = await setup();
		const index: RegistryIndex = {
			registry: "vibes",
			repo: "github.com/imarios/vibes",
			updated_at: new Date().toISOString(),
			entities: [],
			scanner_version: 99,
		};
		await writeRegistryIndex(index, dir);
		const readBack = await readRegistryIndex("vibes", dir);
		expect(readBack?.scanner_version).toBe(SCANNER_VERSION);
	});
});

describe("isCacheCompatible", () => {
	test("returns true when scanner_version matches", () => {
		const index: RegistryIndex = {
			registry: "vibes",
			repo: "x",
			updated_at: new Date().toISOString(),
			entities: [],
			scanner_version: SCANNER_VERSION,
		};
		expect(isCacheCompatible(index)).toBe(true);
	});

	test("returns false when scanner_version is missing", () => {
		const index: RegistryIndex = {
			registry: "vibes",
			repo: "x",
			updated_at: new Date().toISOString(),
			entities: [],
		};
		expect(isCacheCompatible(index)).toBe(false);
	});

	test("returns false when scanner_version is older", () => {
		const index: RegistryIndex = {
			registry: "vibes",
			repo: "x",
			updated_at: new Date().toISOString(),
			entities: [],
			scanner_version: SCANNER_VERSION - 1,
		};
		expect(isCacheCompatible(index)).toBe(false);
	});

	test("returns false when scanner_version is newer (downgrade scenario)", () => {
		// If a user ran a newer skilltree once, then downgraded, the cache
		// fingerprint now claims a higher version than this build can speak.
		// Treat that as incompatible too — same UX as "needs rebuild".
		const index: RegistryIndex = {
			registry: "vibes",
			repo: "x",
			updated_at: new Date().toISOString(),
			entities: [],
			scanner_version: SCANNER_VERSION + 1,
		};
		expect(isCacheCompatible(index)).toBe(false);
	});
});

describe("loadFreshRegistryIndex", () => {
	test("returns the index when scanner_version matches", async () => {
		const dir = await setup();
		const index: RegistryIndex = {
			registry: "vibes",
			repo: "x",
			updated_at: new Date().toISOString(),
			entities: [{ name: "foo", type: "skill", path: "skills/foo" }],
		};
		await writeRegistryIndex(index, dir);
		const loaded = await loadFreshRegistryIndex("vibes", dir);
		expect(loaded).not.toBeNull();
		expect(loaded?.entities[0]?.name).toBe("foo");
	});

	test("returns null when index file is missing", async () => {
		const dir = await setup();
		const loaded = await loadFreshRegistryIndex("nonexistent", dir);
		expect(loaded).toBeNull();
	});

	test("returns null for a corrupt JSON cache (truncated mid-write)", async () => {
		// A torn write or hand-edit of index.json shouldn't crash consumers.
		// The right remediation is identical to "missing" / "outdated":
		// re-run `skilltree registry update`. So treat parse failures as null.
		const dir = await setup();
		const indexPath = getRegistryIndexPath("vibes", dir);
		await mkdir(dirname(indexPath), { recursive: true });
		await writeFile(indexPath, '{"registry":"vibes","entities":[', "utf-8");

		const loaded = await loadFreshRegistryIndex("vibes", dir);
		expect(loaded).toBeNull();
	});

	test("returns null when entities is the wrong shape (defensive against corrupt cache)", async () => {
		// Even with a valid scanner_version, if `entities` isn't an array,
		// every consumer (search/info/add) would crash on `.length` or
		// iteration. Treat shape-violations the same as missing.
		const dir = await setup();
		const indexPath = getRegistryIndexPath("vibes", dir);
		await mkdir(dirname(indexPath), { recursive: true });
		await writeFile(
			indexPath,
			JSON.stringify({
				registry: "vibes",
				repo: "x",
				updated_at: new Date().toISOString(),
				scanner_version: SCANNER_VERSION,
				entities: "not-an-array",
			}),
			"utf-8",
		);

		const loaded = await loadFreshRegistryIndex("vibes", dir);
		expect(loaded).toBeNull();
	});

	test("returns null for a pre-#25 cache (no scanner_version)", async () => {
		// Reproduces the issue #25 bug: a recently-generated but logically-stale
		// index.json (produced by an older scanner) must NOT be served as fresh.
		const dir = await setup();
		const indexPath = getRegistryIndexPath("vibes", dir);
		await mkdir(dirname(indexPath), { recursive: true });
		const raw = {
			registry: "vibes",
			repo: "x",
			updated_at: new Date().toISOString(), // recent — would pass the time-based check
			entities: [{ name: "foo", type: "skill", path: "skills/foo" }],
		};
		await writeFile(indexPath, JSON.stringify(raw), "utf-8");

		const loaded = await loadFreshRegistryIndex("vibes", dir);
		expect(loaded).toBeNull();
	});

	test("returns null when scanner_version is older than current build", async () => {
		const dir = await setup();
		const indexPath = getRegistryIndexPath("vibes", dir);
		await mkdir(dirname(indexPath), { recursive: true });
		const raw = {
			registry: "vibes",
			repo: "x",
			updated_at: new Date().toISOString(),
			scanner_version: SCANNER_VERSION - 1,
			entities: [],
		};
		await writeFile(indexPath, JSON.stringify(raw), "utf-8");

		const loaded = await loadFreshRegistryIndex("vibes", dir);
		expect(loaded).toBeNull();
	});
});

describe("cleanRegistryCache", () => {
	test("removes the registry directory", async () => {
		const dir = await setup();
		const registryDir = join(dir, "vibes");
		await mkdir(registryDir, { recursive: true });
		await writeFile(join(registryDir, "index.json"), "{}", "utf-8");
		expect(existsSync(registryDir)).toBe(true);

		await cleanRegistryCache("vibes", dir);
		expect(existsSync(registryDir)).toBe(false);
	});

	test("is no-op for nonexistent cache", async () => {
		const dir = await setup();
		// Should not throw
		await cleanRegistryCache("ghost", dir);
	});
});

async function createSourceRepo(baseDir: string): Promise<string> {
	const sourceDir = join(baseDir, "source-repo");
	await mkdir(sourceDir, { recursive: true });
	const git = simpleGit(sourceDir);
	await git.init();
	await git.addConfig("user.email", "test@test.com");
	await git.addConfig("user.name", "Test");
	await writeFile(join(sourceDir, "README.md"), "# Test", "utf-8");
	await git.add(".");
	await git.commit("initial");
	return sourceDir;
}

describe("ensureRegistryRepo", () => {
	test("clones a bare repo on first call", async () => {
		const dir = await setup();
		const sourceDir = await createSourceRepo(dir);

		const cacheDir = join(dir, "cache");
		const repoDir = await ensureRegistryRepo("test-reg", sourceDir, cacheDir);

		expect(existsSync(repoDir)).toBe(true);
		const bareGit = simpleGit(repoDir);
		const isBare = await bareGit.raw(["rev-parse", "--is-bare-repository"]);
		expect(isBare.trim()).toBe("true");
	});

	test("fetches on subsequent calls", async () => {
		const dir = await setup();
		const sourceDir = await createSourceRepo(dir);

		const cacheDir = join(dir, "cache");
		await ensureRegistryRepo("test-reg", sourceDir, cacheDir);

		// Add another commit to source
		const git = simpleGit(sourceDir);
		await writeFile(join(sourceDir, "SECOND.md"), "# Second", "utf-8");
		await git.add(".");
		await git.commit("second commit");

		const repoDir = await ensureRegistryRepo("test-reg", sourceDir, cacheDir);
		expect(existsSync(repoDir)).toBe(true);
	});

	test('re-clones when cached config has [remote "origin"] section but no url', async () => {
		// Defensive path: a previous clone was interrupted between the remote
		// section being written and the url being set. cloneOrFetchBare must
		// treat this as drift and re-clone rather than silently fetching
		// against a nonexistent remote.
		const dir = await setup();
		const sourceDir = await createSourceRepo(dir);

		const cacheDir = join(dir, "cache");
		const repoDir = await ensureRegistryRepo("test-reg", sourceDir, cacheDir);

		// Corrupt the cached config: keep the [remote "origin"] header so the
		// clone-vs-fetch path is entered, but strip the actual url line.
		const configPath = join(repoDir, "config");
		const { readFile: rf } = await import("node:fs/promises");
		const original = await rf(configPath, "utf-8");
		const corrupted = original
			.split("\n")
			.filter((line) => !line.trim().startsWith("url ="))
			.join("\n");
		await writeFile(configPath, corrupted, "utf-8");

		// ensureRegistryRepo must recover transparently.
		await ensureRegistryRepo("test-reg", sourceDir, cacheDir);

		const cachedGit = simpleGit(repoDir);
		const origin = (await cachedGit.raw(["config", "--get", "remote.origin.url"])).trim();
		expect(origin).toBe(sourceDir);
	});

	test("re-clones when the registry URL changes (URL drift)", async () => {
		// When config.yaml is edited to point a registry at a new URL, the
		// cached bare repo's `origin` still points at the old URL. A plain
		// `fetch` would silently pull from the wrong source. The cache must
		// be invalidated and re-cloned against the new URL.
		const dir = await setup();

		const originalSource = await createSourceRepo(dir);
		const cacheDir = join(dir, "cache");
		await ensureRegistryRepo("test-reg", originalSource, cacheDir);

		// Create an entirely separate source repo at a different path.
		// Mark it with a unique file so we can prove the re-clone happened.
		const newSource = join(dir, "new-source-repo");
		await mkdir(newSource, { recursive: true });
		const newGit = simpleGit(newSource);
		await newGit.init();
		await newGit.addConfig("user.email", "test@test.com");
		await newGit.addConfig("user.name", "Test");
		await writeFile(join(newSource, "ONLY_IN_NEW.md"), "# only in new", "utf-8");
		await newGit.add(".");
		await newGit.commit("only-in-new");

		const repoDir = await ensureRegistryRepo("test-reg", newSource, cacheDir);

		// The cached repo's origin should now point at the new source, not the old.
		const cachedGit = simpleGit(repoDir);
		const origin = (await cachedGit.raw(["config", "--get", "remote.origin.url"])).trim();
		expect(origin).toBe(newSource);

		// The unique file from the new source must be reachable in the cache.
		const lsTree = await cachedGit.raw(["ls-tree", "-r", "--name-only", "HEAD"]);
		expect(lsTree).toContain("ONLY_IN_NEW.md");
		expect(lsTree).not.toContain("README.md");
	});
});
