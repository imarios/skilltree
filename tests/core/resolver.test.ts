import { describe, expect, test } from "bun:test";
import {
	filterSemverTags,
	parseTag,
	resolveConstraint,
	resolveIntersection,
} from "../../src/core/resolver.js";

describe("parseTag", () => {
	test("parses v-prefixed tag", () => {
		expect(parseTag("v1.0.0")).toBe("1.0.0");
	});

	test("parses tag without prefix", () => {
		expect(parseTag("2.3.1")).toBe("2.3.1");
	});

	test("returns null for non-semver tag", () => {
		expect(parseTag("release-2024-01")).toBeNull();
	});

	test("returns null for uppercase V prefix", () => {
		expect(parseTag("V1.0.0")).toBeNull();
	});
});

describe("filterSemverTags", () => {
	test("filters and sorts tags descending", () => {
		const tags = ["v1.0.0", "release-1", "v2.1.0", "v1.5.0", "nope"];
		const result = filterSemverTags(tags);
		expect(result.map((r) => r.version)).toEqual(["2.1.0", "1.5.0", "1.0.0"]);
	});

	test("returns empty for no valid tags", () => {
		expect(filterSemverTags(["alpha", "beta", "rc1"])).toEqual([]);
	});
});

describe("resolveConstraint", () => {
	const tags = ["v1.0.0", "v1.1.0", "v1.2.0", "v2.0.0", "v2.1.0"];

	test("resolves ^1.0.0 to highest 1.x", () => {
		const result = resolveConstraint(tags, "^1.0.0");
		expect(result?.version).toBe("1.2.0");
	});

	test("resolves * to highest overall", () => {
		const result = resolveConstraint(tags, "*");
		expect(result?.version).toBe("2.1.0");
	});

	test("resolves >=2.0.0", () => {
		const result = resolveConstraint(tags, ">=2.0.0");
		expect(result?.version).toBe("2.1.0");
	});

	test("returns null for unsatisfiable constraint", () => {
		const result = resolveConstraint(tags, "^3.0.0");
		expect(result).toBeNull();
	});

	test("returns null for empty tags", () => {
		const result = resolveConstraint([], "^1.0.0");
		expect(result).toBeNull();
	});
});

describe("resolveIntersection", () => {
	const tags = ["v1.0.0", "v1.1.0", "v1.2.0", "v2.0.0", "v2.1.0"];
	const csrc: import("../../src/core/resolver.js").ConstraintSource = {
		kind: "consumer",
		manifestPath: "skilltree.yml",
	};

	test("intersects compatible constraints", () => {
		const result = resolveIntersection(tags, [
			{ name: "a", constraint: "^1.0.0", source: csrc },
			{ name: "b", constraint: ">=1.1.0", source: csrc },
		]);
		expect("version" in result && result.version).toBe("1.2.0");
	});

	test("errors on incompatible constraints with attribution", () => {
		const result = resolveIntersection(tags, [
			{ name: "a", constraint: "^1.0.0", source: csrc },
			{ name: "b", constraint: "^2.0.0", source: csrc },
		]);
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("Incompatible");
			// Issue #85: every constraint line must name the manifest that imposed it.
			expect(result.error).toContain("skilltree.yml requires a ^1.0.0");
			expect(result.error).toContain("skilltree.yml requires b ^2.0.0");
		}
	});

	test("transitive source renders repo@ref prefix", () => {
		const result = resolveIntersection(tags, [
			{ name: "a", constraint: "^1.0.0", source: csrc },
			{
				name: "b",
				constraint: "^3.0.0",
				source: { kind: "transitive", originRepo: "github.com/up/stream", ref: "v1.2.3" },
			},
		]);
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("github.com/up/stream@v1.2.3 requires b ^3.0.0");
		}
	});

	test("wildcard + specific constraint works", () => {
		const result = resolveIntersection(tags, [
			{ name: "a", constraint: "*", source: csrc },
			{ name: "b", constraint: "^1.0.0", source: csrc },
		]);
		expect("version" in result && result.version).toBe("1.2.0");
	});

	test("errors for no semver tags", () => {
		const result = resolveIntersection(
			["alpha", "beta"],
			[{ name: "a", constraint: "^1.0.0", source: csrc }],
		);
		expect("error" in result).toBe(true);
	});
});
