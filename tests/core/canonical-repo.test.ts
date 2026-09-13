/**
 * Neon Phase 3 (#203): `canonicalRepo` answers "do these two repo strings
 * name the same repo?".
 *
 * Before #203 shipped `freeze`, the only way to give one repo's deps different
 * versions was to spell the URL differently (`…/agent-skills.git`) so the
 * resolver treated it as a second repo. The cache already normalized that
 * spelling away; the resolver didn't. Parametrized per hardening pattern #4:
 * a new spelling is a new row.
 */
import { describe, expect, test } from "bun:test";
import { canonicalRepo } from "../../src/core/git.js";

describe("canonicalRepo", () => {
	const ELASTIC = [
		"github.com/elastic/agent-skills",
		"github.com/elastic/agent-skills.git",
		"https://github.com/elastic/agent-skills",
		"https://github.com/elastic/agent-skills.git",
		"http://github.com/elastic/agent-skills",
		"git@github.com:elastic/agent-skills",
		"git@github.com:elastic/agent-skills.git",
		"github.com/elastic/agent-skills/",
	];

	test.each(ELASTIC)(
		"CR1 %p names the same repo as github.com/elastic/agent-skills",
		(spelling) => {
			expect(canonicalRepo(spelling)).toBe(canonicalRepo("github.com/elastic/agent-skills"));
		},
	);

	test.each([
		"github.com/elastic/agent-skill",
		"github.com/other/agent-skills",
		"gitlab.com/elastic/agent-skills",
	])("CR2 %p is a different repo", (other) => {
		expect(canonicalRepo(other)).not.toBe(canonicalRepo("github.com/elastic/agent-skills"));
	});

	test.each(["file:///tmp/x/upstream.git", "file:///tmp/x/upstream.git/"])(
		"CR3 local %p shares a key with file:///tmp/x/upstream.git",
		(spelling) => {
			expect(canonicalRepo(spelling)).toBe(canonicalRepo("file:///tmp/x/upstream.git"));
		},
	);
});
