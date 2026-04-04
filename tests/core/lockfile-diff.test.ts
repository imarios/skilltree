import { describe, expect, test } from "bun:test";
import { diffManifestLockfile } from "../../src/core/lockfile.js";
import type { Lockfile, Manifest } from "../../src/types.js";

describe("diffManifestLockfile", () => {
	test("detects unchanged entries", () => {
		const manifest: Manifest = {
			dependencies: {
				"my-skill": { repo: "github.com/user/repo", path: "skills/my-skill", version: "^1.0.0" },
			},
		};
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				"my-skill": {
					type: "skill",
					group: "prod",
					repo: "github.com/user/repo",
					path: "skills/my-skill",
					version: "1.2.0",
					commit: "abc",
					dependencies: [],
				},
			},
		};

		const diff = diffManifestLockfile(manifest, lockfile);
		expect(diff.unchanged).toContain("my-skill");
		expect(diff.added).toEqual([]);
		expect(diff.changed).toEqual([]);
	});

	test("detects added entries", () => {
		const manifest: Manifest = {
			dependencies: {
				"new-skill": { repo: "github.com/user/repo", path: "skills/new", version: "*" },
			},
		};
		const lockfile: Lockfile = { lockfile_version: 1, packages: {} };

		const diff = diffManifestLockfile(manifest, lockfile);
		expect(diff.added).toContain("new-skill");
		expect(diff.unchanged).toEqual([]);
	});

	test("detects changed entries (repo changed)", () => {
		const manifest: Manifest = {
			dependencies: {
				"my-skill": {
					repo: "github.com/new-org/repo",
					path: "skills/my-skill",
					version: "*",
				},
			},
		};
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				"my-skill": {
					type: "skill",
					group: "prod",
					repo: "github.com/old-org/repo",
					path: "skills/my-skill",
					version: "1.0.0",
					commit: "abc",
					dependencies: [],
				},
			},
		};

		const diff = diffManifestLockfile(manifest, lockfile);
		expect(diff.changed).toContain("my-skill");
	});

	test("detects changed entries (version no longer satisfies)", () => {
		const manifest: Manifest = {
			dependencies: {
				"my-skill": { repo: "github.com/user/repo", path: "skills/my-skill", version: "^2.0.0" },
			},
		};
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				"my-skill": {
					type: "skill",
					group: "prod",
					repo: "github.com/user/repo",
					path: "skills/my-skill",
					version: "1.5.0",
					commit: "abc",
					dependencies: [],
				},
			},
		};

		const diff = diffManifestLockfile(manifest, lockfile);
		expect(diff.changed).toContain("my-skill");
	});

	test("detects removed entries", () => {
		const manifest: Manifest = { dependencies: {} };
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				"old-skill": {
					type: "skill",
					group: "prod",
					repo: "github.com/user/repo",
					path: "skills/old",
					version: "1.0.0",
					commit: "abc",
					dependencies: [],
				},
			},
		};

		const diff = diffManifestLockfile(manifest, lockfile);
		expect(diff.removed).toContain("old-skill");
	});

	test("local deps are always unchanged in diff", () => {
		const manifest: Manifest = {
			dependencies: {
				"local-skill": { local: "./skills/local" },
			},
		};
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				"local-skill": {
					type: "skill",
					group: "prod",
					source: "local",
					path: "./skills/local",
					commit: "HEAD",
					dependencies: [],
				},
			},
		};

		const diff = diffManifestLockfile(manifest, lockfile);
		expect(diff.unchanged).toContain("local-skill");
	});

	test("transitive deps in lockfile are not marked as removed", () => {
		const manifest: Manifest = {
			dependencies: {
				parent: { repo: "github.com/user/repo", path: "skills/parent", version: "*" },
			},
		};
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				parent: {
					type: "skill",
					group: "prod",
					repo: "github.com/user/repo",
					path: "skills/parent",
					version: "1.0.0",
					commit: "abc",
					dependencies: ["child"],
				},
				child: {
					type: "skill",
					group: "prod",
					repo: "github.com/user/repo",
					path: "skills/child",
					version: "1.0.0",
					commit: "abc",
					dependencies: [],
				},
			},
		};

		const diff = diffManifestLockfile(manifest, lockfile);
		expect(diff.removed).not.toContain("child");
	});

	test("handles empty lockfile", () => {
		const manifest: Manifest = {
			dependencies: {
				a: { repo: "github.com/u/r", path: "a", version: "*" },
			},
		};
		const lockfile: Lockfile = { lockfile_version: 1, packages: {} };

		const diff = diffManifestLockfile(manifest, lockfile);
		expect(diff.added).toContain("a");
		expect(diff.unchanged).toEqual([]);
	});

	test("handles empty manifest", () => {
		const manifest: Manifest = {};
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				orphan: {
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
		expect(diff.removed).toContain("orphan");
	});
});
