import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

/**
 * Issue #168: #163 committed `bun.lock` and froze CI installs, which stopped
 * dev-tooling upgrades from landing unannounced — but also stopped them
 * landing at all. Pinning without an upgrade path trades surprise breakage
 * for silent rot; `@anthropic-ai/sdk` was already 32 minors behind.
 *
 * Dependabot restores the other half: upgrades arrive as reviewable PRs that
 * CI checks before anyone merges them.
 *
 * The repo-specific trap this locks in: `.cz.toml` rewrites the
 * self-referential `@imarios/skilltree-cli-*` optionalDependencies to the new
 * version on every release. Those are release-managed, not dependencies to
 * track, so Dependabot must leave them alone — otherwise it opens PRs that
 * fight the release process. Same self-reference that complicated #163.
 */
describe("build/dependabot-config: upgrades arrive as reviewable PRs (#168)", () => {
	const ROOT = join(__dirname, "..", "..");
	const CONFIG_PATH = join(ROOT, ".github", "dependabot.yml");

	type Update = {
		"package-ecosystem": string;
		directory?: string;
		schedule?: { interval?: string };
		ignore?: Array<{ "dependency-name"?: string }>;
	};

	test("a dependabot config exists", () => {
		expect(existsSync(CONFIG_PATH)).toBe(true);
	});

	const config = existsSync(CONFIG_PATH)
		? (parse(readFileSync(CONFIG_PATH, "utf-8")) as { version?: number; updates?: Update[] })
		: undefined;

	test("declares config version 2", () => {
		expect(config?.version).toBe(2);
	});

	test("tracks the bun ecosystem, matching the committed bun.lock", () => {
		const ecosystems = (config?.updates ?? []).map((u) => u["package-ecosystem"]);
		// `npm` would be wrong: the repo's lockfile is bun.lock, and Dependabot
		// grew first-class `bun` support (GA, Feb 2025) that updates it.
		expect(ecosystems).toContain("bun");
	});

	test("tracks github-actions too", () => {
		const ecosystems = (config?.updates ?? []).map((u) => u["package-ecosystem"]);
		expect(ecosystems).toContain("github-actions");
	});

	test("every update entry declares a schedule", () => {
		const unscheduled = (config?.updates ?? [])
			.filter((u) => u.schedule?.interval === undefined)
			.map((u) => u["package-ecosystem"]);

		expect(unscheduled).toEqual([]);
	});

	test("ignores the release-managed platform binaries", () => {
		const bun = (config?.updates ?? []).find((u) => u["package-ecosystem"] === "bun");
		const ignored = (bun?.ignore ?? []).map((i) => i["dependency-name"]);

		// A glob is required, not four literals: `.cz.toml` would happily gain a
		// fifth platform and this must keep covering it.
		expect(ignored).toContain("@imarios/skilltree-cli-*");
	});

	test("the ignore glob actually covers every platform package in package.json", () => {
		const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
		const bun = (config?.updates ?? []).find((u) => u["package-ecosystem"] === "bun");
		const globs = (bun?.ignore ?? [])
			.map((i) => i["dependency-name"])
			.filter((n): n is string => n !== undefined)
			.map((n) => new RegExp(`^${n.split("*").map(escapeRegExp).join(".*")}$`));

		const uncovered = Object.keys(pkg.optionalDependencies ?? {}).filter(
			(name) => !globs.some((re) => re.test(name)),
		);

		expect(uncovered).toEqual([]);
	});
});

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
