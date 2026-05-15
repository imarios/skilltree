import { describe, expect, test } from "bun:test";
import { lintAsymmetricPublish } from "../../src/commands/check.js";
import type { ResolvedEntity } from "../../src/core/graph.js";

function entity(
	name: string,
	deps: string[] = [],
	opts: { publish?: boolean; group?: "prod" | "dev"; local?: boolean } = {},
): ResolvedEntity {
	const e: ResolvedEntity = {
		key: name,
		name,
		type: "skill",
		group: opts.group ?? "prod",
		path: `./skills/${name}`,
		commit: "HEAD",
		local: opts.local ?? true,
		dependencies: deps,
	};
	if (opts.publish !== undefined) e.publish = opts.publish;
	return e;
}

function buildMap(...entities: ResolvedEntity[]): Map<string, ResolvedEntity> {
	const m = new Map<string, ResolvedEntity>();
	for (const e of entities) m.set(`${e.type}:${e.name}`, e);
	return m;
}

describe("lintAsymmetricPublish (Carbon Phase 5)", () => {
	test("flags direct asymmetric chain (root → publish:false)", () => {
		const entities = buildMap(
			entity("analysis", ["experimental"]),
			entity("experimental", [], { publish: false }),
		);
		const warnings = lintAsymmetricPublish(entities);
		expect(warnings.length).toBe(1);
		expect(warnings[0]).toContain("analysis");
		expect(warnings[0]).toContain("experimental");
		expect(warnings[0]).toContain("publish: false");
	});

	test("flags transitive (2-hop) asymmetric chain — one warning per leaking published root", () => {
		const entities = buildMap(
			entity("analysis", ["loader"]),
			entity("loader", ["experimental"]),
			entity("experimental", [], { publish: false }),
		);
		const warnings = lintAsymmetricPublish(entities);
		// Both `analysis` and `loader` are publicly published AND reach
		// `experimental` (publish:false). Both leak, so both are flagged —
		// fixing `experimental` resolves both warnings.
		expect(warnings.length).toBe(2);
		const joined = warnings.join("\n---\n");
		expect(joined).toContain("analysis");
		expect(joined).toContain("loader");
		expect(joined).toContain("experimental");
	});

	test("flags multiple chains from one root", () => {
		const entities = buildMap(
			entity("analysis", ["wip-a", "wip-b"]),
			entity("wip-a", [], { publish: false }),
			entity("wip-b", [], { publish: false }),
		);
		const warnings = lintAsymmetricPublish(entities);
		expect(warnings.length).toBe(2);
	});

	test("clean manifest — all published — no warnings", () => {
		const entities = buildMap(entity("analysis", ["loader"]), entity("loader", []));
		expect(lintAsymmetricPublish(entities)).toEqual([]);
	});

	test("all entities publish:false — no warnings (no exposed roots)", () => {
		const entities = buildMap(
			entity("a", ["b"], { publish: false }),
			entity("b", [], { publish: false }),
		);
		expect(lintAsymmetricPublish(entities)).toEqual([]);
	});

	test("ignores remote (non-local) deps", () => {
		// 'remote-thing' isn't in the same repo; we don't traverse beyond it.
		const entities = buildMap(
			entity("analysis", ["remote-thing"]),
			// remote-thing intentionally missing from entities — represents a remote dep
		);
		expect(lintAsymmetricPublish(entities)).toEqual([]);
	});

	test("ignores publish:true → remote (still no warning even if remote is dev/private)", () => {
		const remote: ResolvedEntity = {
			key: "remote-tool",
			name: "remote-tool",
			type: "skill",
			group: "prod",
			path: "skills/remote-tool",
			commit: "abc123",
			local: false,
			dependencies: [],
		};
		const entities = buildMap(entity("analysis", ["remote-tool"]), remote);
		expect(lintAsymmetricPublish(entities)).toEqual([]);
	});

	test("skips dev-group roots (they're not consumer-facing in the first place)", () => {
		const entities = buildMap(
			entity("dev-tool", ["wip"], { group: "dev" }),
			entity("wip", [], { publish: false }),
		);
		expect(lintAsymmetricPublish(entities)).toEqual([]);
	});

	test("renders chain in arrow format with the leak marked", () => {
		const entities = buildMap(
			entity("a", ["b"]),
			entity("b", ["c"]),
			entity("c", [], { publish: false }),
		);
		const [warning] = lintAsymmetricPublish(entities);
		expect(warning).toContain("a (published)");
		expect(warning).toContain("→ b (published)");
		expect(warning).toContain("→ c (publish: false)");
		expect(warning).toContain("blocks downstream consumers");
		expect(warning).toContain("Fix:");
	});

	test("handles cycles among published nodes without infinite loop", () => {
		// a → b → a (cycle). No publish:false anywhere → no warnings, no hang.
		const entities = buildMap(entity("a", ["b"]), entity("b", ["a"]));
		expect(lintAsymmetricPublish(entities)).toEqual([]);
	});
});
