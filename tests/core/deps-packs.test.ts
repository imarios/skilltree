import { describe, expect, test } from "bun:test";
import { canonicalSource } from "../../src/core/deps.js";
import type { Dependency } from "../../src/types.js";

describe("canonicalSource — PackDependency", () => {
	test("F1 — local pack ref", () => {
		const dep = { pack: "python-pack" } as unknown as Dependency;
		expect(canonicalSource(dep)).toBe("pack:local:python-pack");
	});

	test("F2 — remote pack ref", () => {
		const dep = {
			pack: "python-pack",
			repo: "github.com/acme/skill-packs",
		} as unknown as Dependency;
		expect(canonicalSource(dep)).toBe("pack:github.com/acme/skill-packs:python-pack");
	});

	test("F3 — source-aliased pack ref resolves to repo URL", () => {
		const dep = { pack: "python-pack", source: "acme" } as unknown as Dependency;
		const k = canonicalSource(dep, { acme: "github.com/acme/skill-packs" });
		expect(k).toBe("pack:github.com/acme/skill-packs:python-pack");
	});

	test("F4 — unresolved source alias produces unspoofable sentinel", () => {
		const dep = { pack: "python-pack", source: "missing" } as unknown as Dependency;
		const k = canonicalSource(dep, {});
		// Must differ from the resolved form and contain a clear marker.
		expect(k).not.toBe("pack:missing:python-pack");
		expect(k).toMatch(/python-pack/);
		expect(k).toMatch(/missing/);
	});

	test("F5 — source-aliased and direct-repo forms unify", () => {
		const aliased = { pack: "python-pack", source: "acme" } as unknown as Dependency;
		const direct = {
			pack: "python-pack",
			repo: "github.com/acme/skill-packs",
		} as unknown as Dependency;
		expect(canonicalSource(aliased, { acme: "github.com/acme/skill-packs" })).toBe(
			canonicalSource(direct),
		);
	});

	test("F6 — same repo, different pack name → different keys", () => {
		const a = { pack: "a", repo: "X" } as unknown as Dependency;
		const b = { pack: "b", repo: "X" } as unknown as Dependency;
		expect(canonicalSource(a)).not.toBe(canonicalSource(b));
	});

	test("F7 — pack ref vs entity ref with same repo are distinct", () => {
		const packRef = { pack: "python-pack", repo: "X" } as unknown as Dependency;
		const entityRef = { repo: "X", path: "python-pack" } as Dependency;
		expect(canonicalSource(packRef)).not.toBe(canonicalSource(entityRef));
	});
});
