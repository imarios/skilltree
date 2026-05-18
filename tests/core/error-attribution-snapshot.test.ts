// Nitrogen Phase 4 — resolver error attribution snapshots.
//
// Captures the *attributed* error text Phase 4.2 introduced. Every snapshot
// includes a manifest identifier (skilltree.yml for consumer, <repo>@<ref>
// for transitive) so the author reading the error knows which file to edit.
// Audit table: docs/planning/nitrogen/phase_4/error-audit.md

import { describe, expect, test } from "bun:test";
import type { ConstraintSource } from "../../src/core/resolver.js";
import { formatConstraintSource, resolveIntersection } from "../../src/core/resolver.js";

const consumerSrc: ConstraintSource = { kind: "consumer", manifestPath: "skilltree.yml" };
const transitive = (originRepo: string, ref: string): ConstraintSource => ({
	kind: "transitive",
	originRepo,
	ref,
});

describe("error attribution snapshots (Phase 4)", () => {
	const tags = ["v1.0.0", "v2.0.0", "v1.5.0"];

	test("A1: single consumer constraint, no compatible tag", () => {
		const result = resolveIntersection(
			["v0.9.2"],
			[{ name: "greet-helper", constraint: "^1.0.0", source: consumerSrc }],
		);
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toMatchSnapshot();
		}
	});

	test("A2: multi-constraint conflict, same repo, both consumer", () => {
		const result = resolveIntersection(tags, [
			{ name: "foo", constraint: "^1.0.0", source: consumerSrc },
			{ name: "bar", constraint: "^2.0.0", source: consumerSrc },
		]);
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toMatchSnapshot();
		}
	});

	test("A2b: three-way constraint conflict, mixed sources", () => {
		const result = resolveIntersection(tags, [
			{ name: "a", constraint: "^1.0.0", source: consumerSrc },
			{
				name: "b",
				constraint: "^2.0.0",
				source: transitive("github.com/acme/upstream", "v1.2.3"),
			},
			{
				name: "c",
				constraint: ">=3.0.0",
				source: transitive("github.com/acme/other", "abc1234567890"),
			},
		]);
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toMatchSnapshot();
		}
	});
});

describe("formatConstraintSource", () => {
	test("consumer source shows manifest path", () => {
		expect(formatConstraintSource(consumerSrc)).toBe("skilltree.yml");
	});

	test("transitive shows repo@short-tag", () => {
		expect(formatConstraintSource(transitive("github.com/acme/up", "v1.2.3"))).toBe(
			"github.com/acme/up@v1.2.3",
		);
	});

	test("transitive shows repo@short-sha for long refs", () => {
		expect(formatConstraintSource(transitive("github.com/acme/up", "abcdef1234567890"))).toBe(
			"github.com/acme/up@abcdef1",
		);
	});
});
