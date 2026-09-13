import { describe, expect, test } from "bun:test";
import { installedName } from "../../src/core/lockfile.js";

/**
 * The name an entity is installed under. Install paths come from this, not
 * from the lockfile key: an aliased entity lives at `skills/<name>` (#102,
 * #205). Parametrized per the hardening convention, so a new shape is a row.
 */
describe("installedName", () => {
	const cases: Array<[string, string, { name?: string }, string]> = [
		["plain entry uses its key", "foo", {}, "foo"],
		["aliased entry uses its name", "my-bar", { name: "bar" }, "bar"],
		["name equal to key is harmless", "bar", { name: "bar" }, "bar"],
	];

	test.each(cases)("%s", (_label, key, entry, expected) => {
		expect(installedName(key, entry)).toBe(expected);
	});
});
