import { afterEach, describe, expect, test } from "bun:test";
import { lstatSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand } from "../../src/commands/install.js";
import { updateCommand } from "../../src/commands/update.js";
import { verifyCommand } from "../../src/commands/verify.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

/**
 * #207: a local dep whose `local:` path does not exist resolved happily.
 *
 * `install`/`update` exited 0 and printed "Done." for a dependency whose
 * source was gone. Local deps install as symlinks, so the installed entry was
 * left dangling — still listed in the lockfile, unreadable on disk — with
 * nothing in the output to say so. A local path that no longer exists is an ordinary
 * situation — the skill was moved or renamed, or you switched to a branch that
 * doesn't have it — and the useful answer is an error naming the path, which
 * is what `add --local` has always done at add time.
 */

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-local-missing-"));
	return tempDir;
}

describe("local dependency with a missing path (#207)", () => {
	test("install fails and names the path", async () => {
		const dir = await makeTempDir();
		await writeFile(
			join(dir, "skilltree.yml"),
			"dependencies:\n  ghost:\n    local: ./skills/ghost\n",
		);

		await expect(installCommand(dir, {})).rejects.toThrow("Resolution failed");
	});

	test("update does not silently uninstall a skill whose source vanished", async () => {
		const dir = await makeTempDir();
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeFile(
			join(dir, "skilltree.yml"),
			"dependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);
		await installCommand(dir, {});

		const installed = join(dir, ".claude", "skills", "my-skill");
		expect(lstatSync(installed).isSymbolicLink()).toBe(true);

		// The source goes away — moved, renamed, or a branch without it.
		await rm(join(dir, "skills"), { recursive: true, force: true });

		await expect(updateCommand(dir, undefined, {})).rejects.toThrow("Resolution failed");

		// A failed update must not touch what's installed: the entry is still
		// there (dangling, because its source is gone — that's the user's move to
		// make, not ours), and the lockfile still describes it.
		expect(lstatSync(installed).isSymbolicLink()).toBe(true);
		const lock = await readFile(join(dir, "skilltree.lock"), "utf-8");
		expect(lock).toContain("my-skill");
	});

	test("the error names the offending path", async () => {
		const dir = await makeTempDir();
		await writeFile(
			join(dir, "skilltree.yml"),
			"dependencies:\n  ghost:\n    local: ./skills/ghost\n",
		);

		const errors: string[] = [];
		const originalError = console.error;
		console.error = (msg?: unknown) => {
			errors.push(String(msg));
		};
		try {
			await installCommand(dir, {}).catch(() => {
				// Expected to fail; this test inspects what it printed.
			});
		} finally {
			console.error = originalError;
		}

		const output = errors.join("\n");
		expect(output).toContain("./skills/ghost");
		expect(output.toLowerCase()).toContain("does not exist");
	});
});

describe("verify still reports a local dep whose source vanished (#207)", () => {
	async function installThenDeleteSource(dir: string): Promise<void> {
		await createLocalSkill(join(dir, "skills"), "my-skill");
		await writeFile(
			join(dir, "skilltree.yml"),
			"dependencies:\n  my-skill:\n    local: ./skills/my-skill\n",
		);
		await installCommand(dir, {});
		await rm(join(dir, "skills"), { recursive: true, force: true });
	}

	async function captureVerify(dir: string, strict: boolean): Promise<string> {
		const lines: string[] = [];
		const log = console.log;
		const err = console.error;
		const warnFn = console.warn;
		const capture = (m?: unknown) => {
			lines.push(String(m));
		};
		console.log = capture;
		console.error = capture;
		// `verify` reports problems through `warn()`, which writes to console.warn.
		console.warn = capture;
		const exitBefore = process.exitCode;
		try {
			await verifyCommand(dir, { strict });
		} finally {
			console.log = log;
			console.error = err;
			console.warn = warnFn;
		}
		const failed = process.exitCode === 1;
		process.exitCode = exitBefore;
		return `${lines.join("\n")}\n__EXIT_FAILED__=${failed}`;
	}

	/**
	 * Resolution no longer registers an entity for a missing local path, and
	 * `verify` builds its table from resolved entities. Without surfacing the
	 * resolution error, the dep would vanish from `verify`'s output entirely —
	 * quieter than before the fix, when it at least showed as a broken symlink.
	 */
	test("verify names the missing dep instead of dropping it", async () => {
		const dir = await makeTempDir();
		await installThenDeleteSource(dir);

		const out = await captureVerify(dir, false);
		expect(out).toContain("my-skill");
		expect(out).toContain("./skills/my-skill");
	});

	test("verify --strict fails on it", async () => {
		const dir = await makeTempDir();
		await installThenDeleteSource(dir);

		const out = await captureVerify(dir, true);
		expect(out).toContain("__EXIT_FAILED__=true");
	});
});
