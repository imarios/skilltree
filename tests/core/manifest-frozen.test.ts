/**
 * Neon Phase 1 (#203): `frozen: <tag>` on a remote dependency.
 *
 * A frozen dep is pinned to one exact tag and takes no part in its repo's
 * shared version resolution, so the field must be an exact version — a range
 * would reintroduce resolution — and it can't sit alongside `version:`.
 */
import { describe, expect, test } from "bun:test";
import { expandSources, validateManifest } from "../../src/core/manifest.js";
import type { Manifest } from "../../src/types.js";

const REPO = "github.com/elastic/agent-skills";

function withDep(dep: Record<string, unknown>): Manifest {
	return { dependencies: { "removed-a": dep } } as unknown as Manifest;
}

describe("validateManifest: frozen", () => {
	test.each(["0.4.0", "v0.4.0", "1.2.3-rc.1"])("MV1 accepts exact tag %p", (frozen) => {
		expect(validateManifest(withDep({ repo: REPO, frozen }))).toEqual([]);
	});

	test.each(["^0.4.0", "~0.4.0", "0.4", "latest", "*", "", 123, true])(
		"MV2 rejects non-exact value %p",
		(frozen) => {
			const errors = validateManifest(withDep({ repo: REPO, frozen }));
			expect(errors).toHaveLength(1);
			expect(errors[0]).toContain("dependencies.removed-a");
			expect(errors[0]).toContain("exact");
		},
	);

	test("MV3 frozen and version are mutually exclusive", () => {
		const errors = validateManifest(withDep({ repo: REPO, frozen: "0.4.0", version: "<0.5.0" }));
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("dependencies.removed-a");
		expect(errors[0]).toContain("mutually exclusive");
	});

	test("MV4 frozen is rejected on local deps", () => {
		const errors = validateManifest(withDep({ local: "./skills/removed-a", frozen: "0.4.0" }));
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("dependencies.removed-a");
		expect(errors[0]).toContain("frozen");
	});

	test("MV5 frozen is rejected on pack references", () => {
		const manifest = {
			dependencies: { kibana: { pack: "kibana-pack", repo: REPO, frozen: "0.4.0" } },
		} as unknown as Manifest;
		const errors = validateManifest(manifest);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain('"frozen" is not valid on pack references');
	});

	test("MV6 frozen is rejected on pack members", () => {
		const manifest = {
			packs: { "kibana-pack": [{ repo: REPO, path: "skills/removed-a", frozen: "0.4.0" }] },
		} as unknown as Manifest;
		const errors = validateManifest(manifest);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("packs.kibana-pack[0]");
		expect(errors[0]).toContain("frozen");
	});

	test("MV7 a source: dep keeps frozen when expanded to a repo dep", () => {
		const manifest = {
			sources: { elastic: REPO },
			dependencies: {
				"removed-a": { source: "elastic", path: "skills/removed-a", frozen: "0.4.0" },
			},
		} as unknown as Manifest;
		expect(validateManifest(manifest)).toEqual([]);
		const dep = expandSources(manifest).dependencies?.["removed-a"] as unknown as Record<
			string,
			unknown
		>;
		expect(dep.repo).toBe(REPO);
		expect(dep.frozen).toBe("0.4.0");
	});
});
