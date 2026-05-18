// Nitrogen Phase 4.1 — baseline snapshots of resolver error text.
//
// These capture the *current* (mis-attributed) error strings. Phase 4.2
// intentionally updates them once the resolver carries `ConstraintSource`
// alongside each constraint. Audit table: docs/planning/nitrogen/phase_4/error-audit.md
//
// Scope of this file: pure-function error builders reachable without async
// fixtures. Integration-level error templates (graph.ts wrapping, duplicate-key
// collision, installer collision) get their own targeted tests in Phase 4.2/4.3.

import { describe, expect, test } from "bun:test";
import { resolveIntersection } from "../../src/core/resolver.js";

describe("error attribution snapshots (Phase 4.1 baseline)", () => {
	const tags = ["v1.0.0", "v2.0.0", "v1.5.0"];

	test("A1: single constraint, no compatible tag", () => {
		const result = resolveIntersection(
			["v0.9.2"],
			[{ name: "greet-helper", constraint: "^1.0.0" }],
		);
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toMatchSnapshot();
		}
	});

	test("A2: multi-constraint conflict, same repo", () => {
		const result = resolveIntersection(tags, [
			{ name: "foo", constraint: "^1.0.0" },
			{ name: "bar", constraint: "^2.0.0" },
		]);
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toMatchSnapshot();
		}
	});

	test("A2b: three-way constraint conflict", () => {
		const result = resolveIntersection(tags, [
			{ name: "a", constraint: "^1.0.0" },
			{ name: "b", constraint: "^2.0.0" },
			{ name: "c", constraint: ">=3.0.0" },
		]);
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toMatchSnapshot();
		}
	});
});
