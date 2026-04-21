import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { canonicalSource } from "../../src/core/deps.js";
import type { Dependency } from "../../src/types.js";

describe("canonicalSource", () => {
	test("remote dep returns its repo URL", () => {
		expect(canonicalSource({ repo: "github.com/x/y", path: "a" })).toBe("github.com/x/y");
	});

	test("source alias resolves to its remote URL", () => {
		const dep = { source: "vibes", path: "skills/foo" } as unknown as Dependency;
		expect(canonicalSource(dep, { vibes: "github.com/x/y" })).toBe("github.com/x/y");
	});

	test("source alias with no entry in sources returns `source:<alias>` sentinel", () => {
		const dep = { source: "unknown", path: "p" } as unknown as Dependency;
		expect(canonicalSource(dep, {})).toBe("source:unknown");
	});

	test("source alias to local path produces `local:<absolute>/<path>`", () => {
		const dep = { source: "mine", path: "foo" } as unknown as Dependency;
		expect(canonicalSource(dep, { mine: "~/skills-root" })).toBe(
			`local:${homedir()}/skills-root/foo`,
		);
	});

	test("source alias to local path with path '.' just returns the base", () => {
		const dep = { source: "mine", path: "." } as unknown as Dependency;
		expect(canonicalSource(dep, { mine: "~/skills-root" })).toBe(`local:${homedir()}/skills-root`);
	});

	test("direct local: dep matches the equivalent source-aliased form", () => {
		const localDep: Dependency = { local: "~/skills-root/foo" };
		const sourceDep = { source: "mine", path: "foo" } as unknown as Dependency;
		const viaLocal = canonicalSource(localDep);
		const viaSource = canonicalSource(sourceDep, { mine: "~/skills-root" });
		expect(viaLocal).toBe(viaSource);
	});

	test("undefined dep returns 'local'", () => {
		expect(canonicalSource(undefined)).toBe("local");
	});

	test("malformed dep (no recognizable fields) returns 'local'", () => {
		expect(canonicalSource({} as Dependency)).toBe("local");
	});

	test("trailing slash in source-aliased local path is normalized away", () => {
		const dep = { source: "mine", path: "foo" } as unknown as Dependency;
		expect(canonicalSource(dep, { mine: "~/skills-root/" })).toBe(
			`local:${homedir()}/skills-root/foo`,
		);
	});
});
