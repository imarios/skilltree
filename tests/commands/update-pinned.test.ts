import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { installCommand } from "../../src/commands/install.js";
import { updateCommand } from "../../src/commands/update.js";
import { addTagToRepo, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-update-pinned-"));
	return tempDir;
}

function captureConsole(): { logs: string[]; restore: () => void } {
	const logs: string[] = [];
	const originalLog = console.log;
	const originalWarn = console.warn;
	console.log = (...args: unknown[]) => logs.push(args.join(" "));
	console.warn = (...args: unknown[]) => logs.push(args.join(" "));
	return {
		logs,
		restore: () => {
			console.log = originalLog;
			console.warn = originalWarn;
		},
	};
}

/**
 * A project depending on `py` at `constraint`, with v1.0.0 and v1.1.0 both
 * tagged upstream before the install. Tagging up front (rather than after)
 * avoids the post-install re-fetch sequence that flakes on CI's Linux+Bun
 * matrix — same reason the `outdated` cap tests do it this way.
 */
async function pinnedProject(constraint: string): Promise<string> {
	const dir = await makeTempDir();
	const repoDir = await createTestRepo(dir, "repo", [{ path: "skills/py", name: "py" }], "v1.0.0");
	const bareDir = join(dir, "bare.git");
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	await addTagToRepo(repoDir, bareDir, "v1.1.0", [{ path: "skills/py", name: "py" }]);

	await writeFile(
		join(dir, "skilltree.yml"),
		`dependencies:
  py:
    repo: "file://${bareDir}"
    path: skills/py
    version: "${constraint}"
`,
		"utf-8",
	);
	await installCommand(dir, {});
	return dir;
}

async function runUpdate(dir: string): Promise<string> {
	const { logs, restore } = captureConsole();
	try {
		await updateCommand(dir, "py", {});
	} finally {
		restore();
	}
	return logs.join("\n");
}

/**
 * Issue #184: with an exact pin, `outdated` advertised a bump, `update`
 * printed "✔ Done." and nothing moved. Refusing to cross the pin is correct
 * — npm behaves the same way — but saying nothing about it is not.
 */
describe("updateCommand on a blocked constraint (#184)", () => {
	test("explains that the pin, not a failure, is why nothing moved", async () => {
		const dir = await pinnedProject("1.0.0");

		const out = await runUpdate(dir);

		expect(out).toContain("pinned at 1.0.0");
		expect(out).toContain("1.1.0");
		// The version really is unchanged — the message is the whole fix.
		expect(await readFile(join(dir, "skilltree.lock"), "utf-8")).toContain("version: 1.0.0");
	});

	test("a range that blocks the latest tag is explained the same way", async () => {
		const dir = await pinnedProject("~1.0.0");

		expect(await runUpdate(dir)).toContain("pinned at ~1.0.0");
	});

	test("says nothing when the constraint admits the newer version", async () => {
		const dir = await pinnedProject("^1.0.0");

		const out = await runUpdate(dir);

		expect(out).not.toContain("pinned at");
		// ...and the update actually happened.
		expect(await readFile(join(dir, "skilltree.lock"), "utf-8")).toContain("version: 1.1.0");
	});

	test("says nothing when a pinned dep is already at the latest tag", async () => {
		const dir = await pinnedProject("1.1.0");

		expect(await runUpdate(dir)).not.toContain("pinned at");
	});
});
