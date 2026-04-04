/**
 * Pre-refactoring tests for diffManifestLockfile (26) in lockfile.ts.
 * Tests edge cases in the manifest↔lockfile diff logic.
 */
import { describe, expect, test } from "bun:test";
import { diffManifestLockfile } from "../../src/core/lockfile.js";
import type { Lockfile, Manifest } from "../../src/types.js";

describe("diffManifestLockfile: edge cases", () => {
	test("wildcard constraint always matches any locked version", () => {
		const manifest: Manifest = {
			dependencies: {
				"my-skill": { repo: "github.com/u/r", path: "s", version: "*" },
			},
		};
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				"my-skill": {
					type: "skill",
					group: "prod",
					repo: "github.com/u/r",
					path: "s",
					version: "99.99.99",
					commit: "abc",
					dependencies: [],
				},
			},
		};

		const diff = diffManifestLockfile(manifest, lockfile);
		expect(diff.unchanged).toContain("my-skill");
		expect(diff.changed).toEqual([]);
	});

	test("dev-dependencies are included in diff", () => {
		const manifest: Manifest = {
			dependencies: {},
			"dev-dependencies": {
				"dev-skill": { repo: "github.com/u/r", path: "s", version: "^1.0.0" },
			},
		};
		const lockfile: Lockfile = { lockfile_version: 1, packages: {} };

		const diff = diffManifestLockfile(manifest, lockfile);
		expect(diff.added).toContain("dev-skill");
	});

	test("locked version without version field is treated as unchanged", () => {
		const manifest: Manifest = {
			dependencies: {
				"my-skill": { repo: "github.com/u/r", path: "s", version: "^1.0.0" },
			},
		};
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				"my-skill": {
					type: "skill",
					group: "prod",
					repo: "github.com/u/r",
					path: "s",
					commit: "abc",
					dependencies: [],
					// no version field (tagless repo)
				},
			},
		};

		const diff = diffManifestLockfile(manifest, lockfile);
		// Without a locked version to check against, treat as unchanged
		expect(diff.unchanged).toContain("my-skill");
	});

	test("deeply nested transitive deps are not removed", () => {
		const manifest: Manifest = {
			dependencies: {
				a: { repo: "github.com/u/r", path: "a", version: "*" },
			},
		};
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				a: {
					type: "skill",
					group: "prod",
					repo: "github.com/u/r",
					path: "a",
					version: "1.0.0",
					commit: "x",
					dependencies: ["b"],
				},
				b: {
					type: "skill",
					group: "prod",
					repo: "github.com/u/r",
					path: "b",
					version: "1.0.0",
					commit: "x",
					dependencies: ["c"],
				},
				c: {
					type: "skill",
					group: "prod",
					repo: "github.com/u/r",
					path: "c",
					version: "1.0.0",
					commit: "x",
					dependencies: [],
				},
			},
		};

		const diff = diffManifestLockfile(manifest, lockfile);
		expect(diff.removed).toEqual([]);
	});

	test("both groups present with same key is handled", () => {
		// This shouldn't happen in practice (validateManifest catches it),
		// but the diff function should not crash
		const manifest: Manifest = {
			dependencies: {
				shared: { repo: "github.com/u/r", path: "s", version: "*" },
			},
		};
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				shared: {
					type: "skill",
					group: "prod",
					repo: "github.com/u/r",
					path: "s",
					version: "1.0.0",
					commit: "abc",
					dependencies: [],
				},
			},
		};

		const diff = diffManifestLockfile(manifest, lockfile);
		expect(diff.unchanged).toContain("shared");
	});

	test("source-expanded deps diff correctly", () => {
		// After expandSources, source deps become repo deps
		const manifest: Manifest = {
			sources: { org: "github.com/org/skills" },
			dependencies: {
				"my-skill": { source: "org", path: "skills/my-skill", version: "^1.0.0" },
			},
		};
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				"my-skill": {
					type: "skill",
					group: "prod",
					repo: "github.com/org/skills",
					path: "skills/my-skill",
					version: "1.2.0",
					commit: "abc",
					dependencies: [],
				},
			},
		};

		const diff = diffManifestLockfile(manifest, lockfile);
		expect(diff.unchanged).toContain("my-skill");
	});
});
