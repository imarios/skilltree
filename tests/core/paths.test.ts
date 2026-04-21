import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import {
	canonicalPath,
	collapseTilde,
	expandTilde,
	getGlobalDir,
	getGlobalInstallBase,
	isLocalSource,
} from "../../src/core/paths.js";

describe("expandTilde", () => {
	test("expands ~ to home directory", () => {
		expect(expandTilde("~")).toBe(homedir());
	});

	test("expands ~/ prefix", () => {
		expect(expandTilde("~/Projects/my-skills")).toBe(`${homedir()}/Projects/my-skills`);
	});

	test("leaves absolute paths unchanged", () => {
		expect(expandTilde("/usr/local/bin")).toBe("/usr/local/bin");
	});

	test("leaves relative paths unchanged", () => {
		expect(expandTilde("./skills/my-style")).toBe("./skills/my-style");
	});

	test("leaves plain strings unchanged", () => {
		expect(expandTilde("github.com/user/repo")).toBe("github.com/user/repo");
	});

	test("does not expand ~ in the middle of a string", () => {
		expect(expandTilde("some/~/path")).toBe("some/~/path");
	});
});

describe("collapseTilde", () => {
	const home = homedir();

	test("collapses home directory to ~", () => {
		expect(collapseTilde(home)).toBe("~");
	});

	test("collapses home prefix to ~/", () => {
		expect(collapseTilde(`${home}/Projects/my-skills`)).toBe("~/Projects/my-skills");
	});

	test("leaves non-home absolute paths unchanged", () => {
		expect(collapseTilde("/usr/local/bin")).toBe("/usr/local/bin");
	});

	test("leaves relative paths unchanged", () => {
		expect(collapseTilde("./skills/my-style")).toBe("./skills/my-style");
	});

	test("round-trips with expandTilde", () => {
		const original = "~/Projects/my-skills/skills/python-coding";
		expect(collapseTilde(expandTilde(original))).toBe(original);
	});
});

describe("isLocalSource", () => {
	test("returns true for ~/ prefix", () => {
		expect(isLocalSource("~/Projects/my-skills")).toBe(true);
	});

	test("returns true for / prefix", () => {
		expect(isLocalSource("/absolute/path")).toBe(true);
	});

	test("returns true for ./ prefix", () => {
		expect(isLocalSource("./relative/path")).toBe(true);
	});

	test("returns false for git URL", () => {
		expect(isLocalSource("github.com/user/repo")).toBe(false);
	});

	test("returns false for plain string", () => {
		expect(isLocalSource("some-alias")).toBe(false);
	});
});

describe("getGlobalDir", () => {
	test("returns expanded ~/.skilltree", () => {
		expect(getGlobalDir()).toBe(`${homedir()}/.skilltree`);
	});
});

describe("getGlobalInstallBase", () => {
	test("returns expanded ~/.claude", () => {
		expect(getGlobalInstallBase()).toBe(`${homedir()}/.claude`);
	});
});

describe("canonicalPath", () => {
	test.each([
		["skills/foo", "skills/foo"],
		["./skills/foo", "skills/foo"],
		["/skills/foo", "skills/foo"],
		["skills/foo/", "skills/foo"],
		["././skills/foo", "skills/foo"],
		["./skills/foo/", "skills/foo"],
		["skills//foo", "skills/foo"],
		["/./skills/foo", "skills/foo"],
		["//skills/foo", "skills/foo"],
		["./././skills/foo/", "skills/foo"],
	])("canonicalPath(%j) === %j", (input, expected) => {
		expect(canonicalPath(input)).toBe(expected);
	});

	test("empty string unchanged", () => {
		expect(canonicalPath("")).toBe("");
	});

	test("preserves .. segments (callers guard via hasDotDotSegment)", () => {
		expect(canonicalPath("skills/foo/..")).toBe("skills/foo/..");
	});

	test("leading dotted directory (.claude) is preserved — not confused with ./", () => {
		expect(canonicalPath(".claude/foo")).toBe(".claude/foo");
	});

	test.each([
		["a/./b", "a/b"],
		["/Users/x/./foo", "Users/x/foo"],
		["skills/./foo/./bar", "skills/foo/bar"],
		["a/./", "a"],
	])("embedded /./ segments are stripped: canonicalPath(%j) === %j", (input, expected) => {
		expect(canonicalPath(input)).toBe(expected);
	});

	test("/.. segments are preserved (callers guard via hasDotDotSegment)", () => {
		expect(canonicalPath("a/../b")).toBe("a/../b");
	});

	test.each([
		[".", ""],
		["./", ""],
		["/", ""],
		["./.", ""],
		["././", ""],
	])("all root forms canonicalize to empty: canonicalPath(%j) === %j", (input, expected) => {
		expect(canonicalPath(input)).toBe(expected);
	});
});
