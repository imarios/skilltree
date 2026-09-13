/**
 * Neon Phase 2 (#203): lockfile entries record `frozen`.
 *
 * Without it the lockfile can't tell "frozen at 0.4.0" from "`*` resolved to
 * 0.4.0", so deleting `frozen:` by hand left the old version locked, and
 * `list` had no way to show frozen state. Additive and optional, like
 * `via_pack` (#153).
 */
import { describe, expect, test } from "bun:test";
import type { ResolvedEntity } from "../../src/core/graph.js";
import {
	buildLockfile,
	diffManifestLockfile,
	parseLockfile,
	serializeLockfile,
} from "../../src/core/lockfile.js";
import type { Dependency, Manifest } from "../../src/types.js";

function entity(key: string, extra: Partial<ResolvedEntity> = {}): ResolvedEntity {
	return {
		key,
		name: key,
		type: "skill",
		group: "prod",
		repo: "github.com/elastic/agent-skills",
		path: `skills/${key}`,
		version: "0.4.0",
		tag: "v0.4.0",
		commit: "a".repeat(40),
		local: false,
		dependencies: [],
		...extra,
	};
}

describe("lockfile: frozen field", () => {
	test("LF1 buildLockfile writes frozen only for frozen entities", () => {
		const lockfile = buildLockfile(
			new Map([
				["skill:removed-a", entity("removed-a", { frozen: "0.4.0" })],
				["skill:stable", entity("stable", { version: "0.6.0" })],
			]),
		);

		expect(lockfile.packages["removed-a"]?.frozen).toBe("0.4.0");
		expect("frozen" in (lockfile.packages.stable ?? {})).toBe(false);
	});

	test("LF2 frozen survives serialize → parse", () => {
		const lockfile = buildLockfile(
			new Map([["skill:removed-a", entity("removed-a", { frozen: "v0.4.0" })]]),
		);

		const parsed = parseLockfile(serializeLockfile(lockfile));

		expect(parsed.packages["removed-a"]?.frozen).toBe("v0.4.0");
	});

	test("LF3 a lockfile written before frozen existed parses without it", () => {
		const parsed = parseLockfile(`lockfile_version: 1
packages:
  stable:
    type: skill
    group: prod
    repo: github.com/elastic/agent-skills
    path: skills/stable
    version: 0.6.0
    commit: ${"b".repeat(40)}
    dependencies: []
`);

		expect(parsed.packages.stable?.version).toBe("0.6.0");
		expect(parsed.packages.stable?.frozen).toBeUndefined();
	});
});

describe("diffManifestLockfile: frozen changes (LF4)", () => {
	const REPO = "github.com/elastic/agent-skills";

	function lockedStable(extra: Record<string, unknown>) {
		return {
			lockfile_version: 1 as const,
			packages: {
				stable: {
					type: "skill" as const,
					group: "prod" as const,
					repo: REPO,
					path: "skills/stable",
					version: "0.4.0",
					commit: "c".repeat(40),
					dependencies: [],
					...extra,
				},
			},
		};
	}

	function manifestStable(extra: Record<string, unknown>): Manifest {
		return {
			dependencies: { stable: { repo: REPO, path: "skills/stable", ...extra } as Dependency },
		};
	}

	test.each([
		["frozen removed by hand", { frozen: "0.4.0" }, { version: "*" }, "changed"],
		["frozen added to an unfrozen lock", {}, { frozen: "0.4.0" }, "changed"],
		["frozen moved to another tag", { frozen: "0.4.0" }, { frozen: "0.6.0" }, "changed"],
		[
			"same version, different tag spelling",
			{ frozen: "v0.4.0" },
			{ frozen: "0.4.0" },
			"unchanged",
		],
		["same frozen tag", { frozen: "0.4.0" }, { frozen: "0.4.0" }, "unchanged"],
	] as const)("%s", (_label, locked, declared, expected) => {
		const diff = diffManifestLockfile(manifestStable(declared), lockedStable(locked));

		expect(diff[expected]).toContain("stable");
	});
});
