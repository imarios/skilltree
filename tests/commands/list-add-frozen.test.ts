/**
 * Neon Phase 2 (#203): `list` shows frozen deps, and `add` over a frozen entry
 * says it unfroze it.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { addCommand } from "../../src/commands/add.js";
import { installCommand } from "../../src/commands/install.js";
import { listCommand } from "../../src/commands/list.js";
import { readManifest } from "../../src/core/manifest.js";
import { addTagToRepo, createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string | undefined;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
	tempDir = undefined;
});

interface Fixture {
	projectDir: string;
	repo: string;
}

async function frozenProject(): Promise<Fixture> {
	const dir = await mkdtemp(join(tmpdir(), "skilltree-list-add-frozen-"));
	tempDir = dir;
	const skills = [{ path: "skills/stable", name: "stable" }];
	const repoDir = await createTestRepo(dir, "upstream", skills, "v0.4.0");
	const bareDir = join(dir, "upstream.git");
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	await addTagToRepo(repoDir, bareDir, "v0.6.0", skills);

	const projectDir = join(dir, "project");
	await mkdir(projectDir, { recursive: true });
	const repo = `file://${bareDir}`;
	await writeFile(
		join(projectDir, "skilltree.yml"),
		`dependencies:
  stable:
    repo: "${repo}"
    path: skills/stable
    type: skill
    frozen: "0.4.0"
`,
	);
	return { projectDir, repo };
}

async function captureOutput(run: () => Promise<void>): Promise<string> {
	const lines: string[] = [];
	const record = (...args: unknown[]) => {
		lines.push(args.join(" "));
	};
	const log = spyOn(console, "log").mockImplementation(record);
	const err = spyOn(console, "error").mockImplementation(record);
	const warn = spyOn(console, "warn").mockImplementation(record);
	try {
		await run();
	} finally {
		log.mockRestore();
		err.mockRestore();
		warn.mockRestore();
	}
	return lines.join("\n");
}

describe("list: frozen deps (#203)", () => {
	test("LS1 the table marks the version frozen; JSON keeps version plain and adds frozen", async () => {
		const fx = await frozenProject();
		await installCommand(fx.projectDir, {});

		const table = await captureOutput(() => listCommand(fx.projectDir));
		const json = JSON.parse(
			await captureOutput(() => listCommand(fx.projectDir, { json: true })),
		) as Array<Record<string, unknown>>;

		expect(table).toContain("0.4.0 (frozen)");
		const row = json.find((r) => r.name === "stable");
		expect(row?.version).toBe("0.4.0");
		expect(row?.frozen).toBe("0.4.0");
	});
});

describe("add: over a frozen entry (#203)", () => {
	test("AD1 re-adding drops frozen and warns that it unfroze the dep", async () => {
		const fx = await frozenProject();

		const output = await captureOutput(() =>
			addCommand(
				"stable",
				{ repo: fx.repo, path: "skills/stable", type: "skill", version: "*" },
				fx.projectDir,
			),
		);

		const entry = (await readManifest(fx.projectDir)).dependencies?.stable as unknown as Record<
			string,
			unknown
		>;
		expect("frozen" in entry).toBe(false);
		expect(output).toContain('"stable" was frozen at 0.4.0');
	});
});
