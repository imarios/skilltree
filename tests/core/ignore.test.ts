import { describe, expect, test } from "bun:test";
import { IgnoreMatcher } from "../../src/core/ignore.js";

describe("IgnoreMatcher — gitignore-subset patterns", () => {
	const cases: Array<{ pattern: string; path: string; ignored: boolean; note?: string }> = [
		// Literal directory match (with trailing slash)
		{ pattern: "experiments/", path: "experiments", ignored: true },
		{ pattern: "experiments/", path: "experiments/foo.md", ignored: true },
		{ pattern: "experiments/", path: "experiments/nested/x", ignored: true },
		{
			pattern: "experiments/",
			path: "deep/experiments/foo.md",
			ignored: true,
			note: "floating dir match",
		},
		{ pattern: "experiments/", path: "experiments-2/foo.md", ignored: false },

		// Literal without trailing slash — matches files or dirs anywhere
		{ pattern: "scratch", path: "scratch", ignored: true },
		{ pattern: "scratch", path: "scratch/x", ignored: true },
		{ pattern: "scratch", path: "subdir/scratch", ignored: true },
		{ pattern: "scratch", path: "scratch-tmp", ignored: false },

		// Single-asterisk glob within segment
		{ pattern: "*.scratch.md", path: "foo.scratch.md", ignored: true },
		{ pattern: "*.scratch.md", path: "deep/foo.scratch.md", ignored: true },
		{
			pattern: "*.scratch.md",
			path: "scratch.md",
			ignored: false,
			note: "needs at least the dot prefix",
		},
		{ pattern: "*.scratch.md", path: "foo.md", ignored: false },

		// Double-asterisk crosses segments
		{ pattern: "**/results", path: "results", ignored: true },
		{ pattern: "**/results", path: "a/b/results", ignored: true },

		// Slash-containing pattern is root-anchored
		{ pattern: "skills/foo", path: "skills/foo", ignored: true },
		{ pattern: "skills/foo", path: "skills/foo/x.md", ignored: true },
		{ pattern: "skills/foo", path: "other/skills/foo", ignored: false },

		// Leading slash also anchors
		{ pattern: "/cache.json", path: "cache.json", ignored: true },
		{ pattern: "/cache.json", path: "subdir/cache.json", ignored: false },

		// Single-char wildcard
		{ pattern: "tmp?", path: "tmpa", ignored: true },
		{ pattern: "tmp?", path: "tmp", ignored: false },

		// Question mark does not cross /
		{ pattern: "a/?", path: "a/b", ignored: true },
		{ pattern: "a/?", path: "a/bb", ignored: false },
	];

	for (const c of cases) {
		const label = `${c.pattern} ${c.ignored ? "ignores" : "skips"} ${c.path}${c.note ? ` — ${c.note}` : ""}`;
		test(label, () => {
			const m = new IgnoreMatcher([c.pattern]);
			expect(m.ignores(c.path)).toBe(c.ignored);
		});
	}
});

describe("IgnoreMatcher — multi-pattern + comments + blanks", () => {
	test("ignores if any pattern matches", () => {
		const m = new IgnoreMatcher(["experiments/", "*.scratch.md", "ab-results/"]);
		expect(m.ignores("experiments/x")).toBe(true);
		expect(m.ignores("foo.scratch.md")).toBe(true);
		expect(m.ignores("ab-results/y")).toBe(true);
		expect(m.ignores("skills/foo/SKILL.md")).toBe(false);
	});

	test("skips empty and comment lines", () => {
		const m = new IgnoreMatcher(["", "  ", "# comment", "experiments/"]);
		expect(m.ignores("experiments/x")).toBe(true);
		expect(m.ignores("anywhere/else")).toBe(false);
	});

	test("isEmpty when no real patterns", () => {
		const empty = new IgnoreMatcher(["", "# c", "  "]);
		expect(empty.isEmpty).toBe(true);
		const nonEmpty = new IgnoreMatcher(["experiments/"]);
		expect(nonEmpty.isEmpty).toBe(false);
	});

	test("normalizes trailing slash on the tested path", () => {
		const m = new IgnoreMatcher(["experiments/"]);
		expect(m.ignores("experiments/")).toBe(true);
		expect(m.ignores("experiments")).toBe(true);
	});
});
