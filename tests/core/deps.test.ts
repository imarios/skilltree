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

	test("source alias with no entry in sources returns unspoofable sentinel (not collidable with a repo URL)", () => {
		const dep = { source: "unknown", path: "p" } as unknown as Dependency;
		const key = canonicalSource(dep, {});
		// Sentinel starts with whitespace — no git URL scheme does, so collision with
		// a user-authored `repo:` value is impossible while remaining human-readable.
		expect(key).toBe("unresolved source alias: unknown");
		expect(canonicalSource({ repo: "source:unknown", path: "p" })).toBe("source:unknown");
		expect(canonicalSource({ repo: "source:unknown", path: "p" })).not.toBe(key);
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

	test("path-side trailing slash in source-aliased form is normalized", () => {
		const dep = { source: "mine", path: "foo/" } as unknown as Dependency;
		expect(canonicalSource(dep, { mine: "~/skills-root" })).toBe(
			`local:${homedir()}/skills-root/foo`,
		);
	});

	test("local: dep with trailing slash unifies with the equivalent source-aliased form", () => {
		const localDep: Dependency = { local: "~/skills-root/foo/" };
		const sourceDep = { source: "mine", path: "foo" } as unknown as Dependency;
		expect(canonicalSource(localDep)).toBe(canonicalSource(sourceDep, { mine: "~/skills-root" }));
	});

	test("local: dep with duplicate slashes unifies with the clean form", () => {
		const dirty: Dependency = { local: "~/skills-root//foo" };
		const clean: Dependency = { local: "~/skills-root/foo" };
		expect(canonicalSource(dirty)).toBe(canonicalSource(clean));
	});

	test("source path starting with / doesn't produce a double slash", () => {
		const dep = { source: "mine", path: "/foo" } as unknown as Dependency;
		expect(canonicalSource(dep, { mine: "~/skills-root" })).toBe(
			`local:${homedir()}/skills-root/foo`,
		);
	});
});
