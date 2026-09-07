import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Issue #163: `bun.lock` was gitignored and CI ran a bare `bun install`, so
 * every CI run resolved dev dependencies fresh. A new minor of `@biomejs/biome`
 * (pinned `^2.4.10`) shipped new diagnostics and turned the `Lint` step red on
 * a PR that had changed nothing — #162 had to carry unrelated mechanical fixes
 * just to go green.
 *
 * Fix: commit `bun.lock` and install with `--frozen-lockfile` in CI, so the
 * toolchain only moves when someone commits a new lockfile.
 *
 * The subtlety this test guards: `.cz.toml` bumps the self-referential
 * `optionalDependencies` (`@imarios/skilltree-cli-*`) on every release, which
 * invalidates the committed lockfile. If the release does not refresh the
 * lockfile inside the bump commit, `--frozen-lockfile` fails on the bump
 * commit and on every PR after it — the same unrelated-red-CI tax this issue
 * set out to remove. See the "Refresh lockfile" step in `release.yml`.
 */
describe("build/lockfile-policy: bun.lock is committed and CI installs are frozen (#163)", () => {
	const ROOT = join(__dirname, "..", "..");
	const LOCKFILE = join(ROOT, "bun.lock");
	const WORKFLOW_DIR = join(ROOT, ".github", "workflows");

	const workflows = readdirSync(WORKFLOW_DIR)
		.filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
		.map((f) => ({ name: f, source: readFileSync(join(WORKFLOW_DIR, f), "utf-8") }));

	test("bun.lock is not gitignored", () => {
		const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf-8");
		// Match any spelling of the rule -- `bun.lock`, `/bun.lock`, `bun.lock*`,
		// `**/bun.lock` -- rather than only the bare literal that was there.
		// `!`-prefixed lines are un-ignores, which are the opposite of the bug.
		const ignored = gitignore
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("!"))
			.filter((line) => line.includes("bun.lock"));

		expect(ignored).toEqual([]);
	});

	test("bun.lock is present in the repo", () => {
		expect(existsSync(LOCKFILE)).toBe(true);
	});

	test("bun.lock records the same dependency ranges as package.json", () => {
		const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
		// bun.lock is JSONC (trailing commas), so read the workspace block as text.
		const lock = readFileSync(LOCKFILE, "utf-8");
		const packagesAt = lock.indexOf('"packages"');
		expect(packagesAt).toBeGreaterThan(-1);
		const workspace = lock.slice(0, packagesAt);

		const declared = {
			...pkg.dependencies,
			...pkg.devDependencies,
			...pkg.optionalDependencies,
		} as Record<string, string>;

		const drifted: string[] = [];
		for (const [name, range] of Object.entries(declared)) {
			if (!workspace.includes(`"${name}": "${range}"`)) {
				drifted.push(`${name}@${range}`);
			}
		}

		expect(drifted).toEqual([]);
	});

	test("every workflow `bun install` is frozen or lockfile-only", () => {
		const offenders: string[] = [];

		for (const { name, source } of workflows) {
			for (const [index, line] of source.split("\n").entries()) {
				if (line.trim().startsWith("#")) continue; // prose, not a step
				if (!/\bbun install\b/.test(line)) continue;
				if (line.includes("--frozen-lockfile") || line.includes("--lockfile-only")) continue;
				offenders.push(`${name}:${index + 1}: ${line.trim()}`);
			}
		}

		expect(offenders).toEqual([]);
	});

	test("release.yml refreshes the lockfile after bumping the version", () => {
		const release = workflows.find((w) => w.name === "release.yml");
		expect(release).toBeDefined();

		const source = release?.source ?? "";
		expect(source).toContain("bun install --lockfile-only");

		// The refresh has to land inside the bump commit, before it is pushed —
		// otherwise main carries a lockfile that no longer matches package.json.
		const refreshAt = source.indexOf("bun install --lockfile-only");
		const pushAt = source.indexOf("git push origin main");
		expect(refreshAt).toBeGreaterThan(-1);
		expect(pushAt).toBeGreaterThan(refreshAt);
	});
});
