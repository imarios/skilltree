import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Issue #198: `v0.38.14` published successfully — the package was live and
 * tagged `latest` — but the Release run went red, because the step *after*
 * the publish gave up waiting for the registry to become readable after ~90s.
 *
 * That matters more than an ordinary flake. #170 was a real publish failure
 * that left a tag with nothing on npm for six weeks, and the defense against a
 * repeat is that a red Release run means something. A check that reddens a
 * successful release trains the opposite reflex.
 *
 * The step's own comment said propagation "can take 30–90s" and then set the
 * budget to exactly 90s — the cap equal to the upper bound it exists to
 * absorb. These tests pin the contract that replaced it.
 */

const repoRoot = join(import.meta.dir, "..", "..");
const script = join(repoRoot, "scripts", "verify-npm-publish.sh");

/**
 * Run the verifier against a stub `npm` placed first on PATH, so the retry
 * behavior is exercised for real rather than asserted from the source text.
 * `body` is the stub's shell body; it receives the same argv npm would.
 */
async function runWithStubNpm(
	body: string,
	args: string[] = ["skilltree-pm", "1.2.3"],
	env: Record<string, string> = {},
): Promise<{ code: number; out: string }> {
	const binDir = await mkdtemp(join(tmpdir(), "skilltree-npm-stub-"));
	const stub = join(binDir, "npm");
	await writeFile(stub, `#!/usr/bin/env bash\n${body}\n`, "utf8");
	await chmod(stub, 0o755);

	const proc = Bun.spawn([script, ...args], {
		env: {
			...process.env,
			PATH: `${binDir}:${process.env.PATH}`,
			// Keep the suite fast; the real defaults are asserted separately.
			VERIFY_ATTEMPTS: "3",
			VERIFY_DELAY: "0",
			STUB_DIR: binDir,
			...env,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, out: out + err };
}

describe("verify-npm-publish.sh (#198)", () => {
	test("succeeds when the version is already visible", async () => {
		const { code, out } = await runWithStubNpm("exit 0");

		expect(code).toBe(0);
		expect(out).toContain("1.2.3");
	});

	test("keeps retrying and succeeds once the registry catches up", async () => {
		// Fails the first attempt, succeeds the second — the exact shape of the
		// propagation delay that reddened #198's release.
		const { code, out } = await runWithStubNpm(
			'C="$STUB_DIR/count"; N=$(cat "$C" 2>/dev/null || echo 0); N=$((N+1)); echo "$N" > "$C"; [ "$N" -ge 2 ]',
		);

		expect(code).toBe(0);
		expect(out).toContain("attempt 2");
	});

	test("fails only after exhausting the budget, and says the publish itself succeeded", async () => {
		const { code, out } = await runWithStubNpm("exit 1");

		expect(code).not.toBe(0);
		// A reader must be able to tell this from a refused publish (#170),
		// which is the failure this one is visually identical to.
		// Intent, not exact wording: the reader must be told the publish itself
		// was fine, and that acting on it means re-running rather than panicking.
		expect(out.toLowerCase()).toMatch(/succe(ed|ss)/);
		expect(out.toLowerCase()).toContain("refused publish");
		expect(out.toLowerCase()).toMatch(/re-run|rerun|retry/);
	});

	test("requires both a package name and a version", async () => {
		const { code } = await runWithStubNpm("exit 0", ["skilltree-pm"]);

		expect(code).not.toBe(0);
	});
});

describe("npm publish verification is shared and generous (#198)", () => {
	async function workflow(name: string): Promise<string> {
		return readFile(join(repoRoot, ".github", "workflows", name), "utf8");
	}

	test("both workflows call the shared script instead of inlining the loop", async () => {
		// The loop was edited twice (#39, then #198). Two copies means the next
		// edit lands in one of them.
		for (const name of ["release.yml", "publish.yml"]) {
			const text = await workflow(name);
			expect(text).toContain("scripts/verify-npm-publish.sh");
			expect(text).not.toContain("Not visible yet (attempt");
		}
	});

	test("the default budget is at least five minutes", async () => {
		const text = await readFile(script, "utf8");
		const attempts = Number(/VERIFY_ATTEMPTS:-(\d+)/.exec(text)?.[1]);
		const delay = Number(/VERIFY_DELAY:-(\d+)/.exec(text)?.[1]);

		expect(Number.isFinite(attempts)).toBe(true);
		expect(Number.isFinite(delay)).toBe(true);
		// 90s was the cap that failed a good release. The budget must clear the
		// upper bound of registry propagation with room to spare, not equal it.
		expect(attempts * delay).toBeGreaterThanOrEqual(300);
	});
});
