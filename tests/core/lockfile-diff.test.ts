import { describe, expect, test } from "bun:test";
import { diffManifestLockfile } from "../../src/core/lockfile.js";
import type { Lockfile, Manifest } from "../../src/types.js";
import { localEntry, remoteEntry } from "../helpers/lockfile-fixtures.js";

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
				"my-skill": remoteEntry("my-skill", {
					repo: "github.com/user/repo",
					path: "skills/my-skill",
					version: "1.2.0",
				}),
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
				"local-skill": localEntry("local-skill", { path: "./skills/local" }),
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

// ---------------------------------------------------------------------------
// Pack references (#161)
//
// A `pack:` ref lives in the manifest under one key but expands to N lockfile
// entries, each carrying `via_pack: <that key>`. A name-to-name diff therefore
// reports the pack key as `added` and every expanded entry as `removed` on
// every run — `doctor`'s lockfile-sync check never converges, and its
// "run install to sync" remediation loops forever. The lockfile already
// records the attribution needed to resolve this.
// ---------------------------------------------------------------------------

describe("diffManifestLockfile — pack references (#161)", () => {
	const packManifest = (): Manifest => ({
		dependencies: {
			"elastic-stack": { pack: "elastic-stack", repo: "github.com/example/elastic-skills" },
		},
	});

	test("pack ref satisfied by its expanded entries produces an empty diff", () => {
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				"elastic-architect": remoteEntry("elastic-architect", { viaPack: "elastic-stack" }),
				"elasticsearch-audit": remoteEntry("elasticsearch-audit", { viaPack: "elastic-stack" }),
			},
		};

		const diff = diffManifestLockfile(packManifest(), lockfile);
		expect(diff.added).toEqual([]);
		expect(diff.removed).toEqual([]);
		expect(diff.changed).toEqual([]);
		expect(diff.packs).toEqual(["elastic-stack"]);
	});

	test("expanded members are reported under `packs`, not mixed into `unchanged`", () => {
		// `unchanged` holds manifest keys; a pack's members are lockfile keys.
		// Keeping them apart is what lets `install` tell "provably current"
		// from "accounted for but not provable" — see LockfileDiff.packs.
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				"elastic-architect": remoteEntry("elastic-architect", { viaPack: "elastic-stack" }),
			},
		};

		const diff = diffManifestLockfile(packManifest(), lockfile);
		expect(diff.unchanged).toEqual([]);
		expect(diff.removed).toEqual([]);
		expect(diff.packs).toEqual(["elastic-stack"]);
	});

	test("via_pack is matched against the manifest KEY, not the pack's name", () => {
		// The two differ whenever a consumer names the ref something else;
		// `via_pack` records the consumer's yaml key (see graph.ts).
		const manifest: Manifest = {
			dependencies: {
				"my-stack": { pack: "elastic-stack", repo: "github.com/example/elastic-skills" },
			},
		};
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				"elastic-architect": remoteEntry("elastic-architect", { viaPack: "my-stack" }),
			},
		};

		const diff = diffManifestLockfile(manifest, lockfile);
		expect(diff.added).toEqual([]);
		expect(diff.removed).toEqual([]);
		expect(diff.packs).toEqual(["my-stack"]);
	});

	// Each row: a lockfile that must NOT satisfy `elastic-stack`, and the
	// entries that should therefore be reported as orphaned.
	const unsatisfiedCases: Array<[string, Lockfile["packages"], string[]]> = [
		["an empty lockfile", {}, []],
		[
			"entries attributed to a different pack",
			{ "other-skill": remoteEntry("other-skill", { viaPack: "some-other-pack" }) },
			["other-skill"],
		],
		[
			// Hand-edited `via_pack: ""` is a value, not an absence — it must not
			// be treated as attribution. See "Presence check ≠ value check".
			"a blank via_pack",
			{ "elastic-architect": remoteEntry("elastic-architect", { viaPack: "" }) },
			["elastic-architect"],
		],
		[
			"entries with no via_pack at all",
			{ "elastic-architect": remoteEntry("elastic-architect") },
			["elastic-architect"],
		],
	];

	test.each(unsatisfiedCases)(
		"pack ref unsatisfied by %s is reported as added",
		(_label, packages, expectedRemoved) => {
			const diff = diffManifestLockfile(packManifest(), { lockfile_version: 1, packages });
			expect(diff.added).toContain("elastic-stack");
			expect(diff.packs).toEqual([]);
			expect(diff.removed).toEqual(expectedRemoved);
		},
	);

	test("lock entry attributed to a pack no longer in the manifest is removed", () => {
		const manifest: Manifest = { dependencies: {} };
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				"stale-member": remoteEntry("stale-member", { viaPack: "dropped-pack" }),
			},
		};

		const diff = diffManifestLockfile(manifest, lockfile);
		expect(diff.removed).toContain("stale-member");
	});

	test("pack refs and normal deps coexist without cross-contamination", () => {
		const manifest: Manifest = {
			dependencies: {
				"elastic-stack": { pack: "elastic-stack", repo: "github.com/example/elastic-skills" },
				"solo-skill": { repo: "github.com/example/solo", path: "skills/solo", version: "^1.0.0" },
				"missing-skill": { repo: "github.com/example/x", path: "skills/x", version: "*" },
			},
		};
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				"elastic-architect": remoteEntry("elastic-architect", { viaPack: "elastic-stack" }),
				"solo-skill": remoteEntry("solo-skill", {
					repo: "github.com/example/solo",
					path: "skills/solo",
					version: "1.2.0",
				}),
			},
		};

		const diff = diffManifestLockfile(manifest, lockfile);
		expect(diff.added).toEqual(["missing-skill"]);
		expect(diff.removed).toEqual([]);
		expect(diff.unchanged).toContain("solo-skill");
	});

	test("transitive deps of a pack member are not marked as removed", () => {
		const lockfile: Lockfile = {
			lockfile_version: 1,
			packages: {
				"elastic-architect": remoteEntry("elastic-architect", {
					viaPack: "elastic-stack",
					deps: ["shared-helper"],
				}),
				"shared-helper": remoteEntry("shared-helper"),
			},
		};

		const diff = diffManifestLockfile(packManifest(), lockfile);
		expect(diff.removed).toEqual([]);
	});
});
