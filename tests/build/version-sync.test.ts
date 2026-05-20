import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Issue #70: a fresh user running `npx skilltree-pm` hit
 * `could not find package "@imarios/skilltree-cli-<platform>"` because the
 * git repo's `optionalDependencies` and platform package.json files were
 * pinned at 0.10.0 while the main package was at 0.27.x. The published
 * artifact was kept in lockstep by `build-npm.sh` at publish time, but the
 * git source-of-truth drifted between every release.
 *
 * Fix: `.cz.toml` now declares all five package.json files under
 * `version_files`, so `cz bump` bumps every version in lockstep. This test
 * is the post-fix invariant: anyone editing one version without the others
 * fails CI.
 */
describe("release/version-sync: optionalDependencies pin tracks package version (#70)", () => {
	const ROOT = join(__dirname, "..", "..");
	const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
	const PLATFORMS = ["cli-darwin-arm64", "cli-darwin-x64", "cli-linux-arm64", "cli-linux-x64"];

	test("optionalDependencies entries match root package.version", () => {
		const expected = rootPkg.version;
		for (const platform of PLATFORMS) {
			const key = `@imarios/skilltree-${platform}`;
			expect(rootPkg.optionalDependencies?.[key]).toBe(expected);
		}
	});

	test("each platform package.json version matches root package.version", () => {
		const expected = rootPkg.version;
		for (const platform of PLATFORMS) {
			const platformPkg = JSON.parse(
				readFileSync(join(ROOT, "npm", platform, "package.json"), "utf-8"),
			);
			expect(platformPkg.version).toBe(expected);
		}
	});
});
