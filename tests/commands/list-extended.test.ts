import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCommand } from "../../src/commands/list.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

function captureConsole(): { logs: string[]; restore: () => void } {
	const logs: string[] = [];
	const originalLog = console.log;
	console.log = (...args: unknown[]) => logs.push(args.join(" "));
	return { logs, restore: () => (console.log = originalLog) };
}

const LOCKFILE_WITH_DEPS = `lockfile_version: 1
packages:
  my-skill:
    type: skill
    group: prod
    source: local
    path: ./skills/my-skill
    commit: HEAD
    dependencies: []
  dev-skill:
    type: skill
    group: dev
    source: local
    path: ./skills/dev-skill
    commit: HEAD
    dependencies: []
`;

describe("listCommand extended", () => {
	test("--json outputs JSON array", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		await writeFile(join(tempDir, "skilltree.yml"), "name: test\n");
		await writeFile(join(tempDir, "skilltree.lock"), LOCKFILE_WITH_DEPS);

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir, { json: true });
		} finally {
			restore();
		}

		const json = JSON.parse(logs.join(""));
		expect(Array.isArray(json)).toBe(true);
		expect(json.length).toBe(2);
		expect(json.some((r: { name: string }) => r.name === "my-skill")).toBe(true);
	});

	test("--json with empty lockfile outputs empty array", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		await writeFile(join(tempDir, "skilltree.yml"), "name: test\n");

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir, { json: true });
		} finally {
			restore();
		}
		expect(logs.join("").trim()).toBe("[]");
	});

	test("--global with no global lockfile shows empty message", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		const globalDir = join(tempDir, "global");
		await mkdir(globalDir, { recursive: true });

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir, { global: true, globalDir });
		} finally {
			restore();
		}
		expect(logs.some((l) => l.includes("No global dependencies"))).toBe(true);
	});

	test("--global lists global deps without Group column", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		const globalDir = join(tempDir, "global");
		await mkdir(globalDir, { recursive: true });
		await writeFile(
			join(globalDir, "global.lock"),
			"lockfile_version: 1\npackages:\n  global-skill:\n    type: skill\n    group: prod\n    source: local\n    path: ~/skills/global-skill\n    commit: HEAD\n    dependencies: []\n",
		);

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir, { global: true, globalDir });
		} finally {
			restore();
		}
		expect(logs.some((l) => l.includes("global-skill"))).toBe(true);
		// Global table should NOT have Group column header
		expect(logs.some((l) => l.includes("Group"))).toBe(false);
	});

	test("project list shows Group column", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		await writeFile(join(tempDir, "skilltree.yml"), "name: test\n");
		await writeFile(join(tempDir, "skilltree.lock"), LOCKFILE_WITH_DEPS);

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir);
		} finally {
			restore();
		}
		expect(logs.some((l) => l.includes("Group"))).toBe(true);
	});

	test("shows remote dep version and source", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		await writeFile(join(tempDir, "skilltree.yml"), "name: test\n");
		await writeFile(
			join(tempDir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  remote-skill:\n    type: skill\n    group: prod\n    repo: github.com/org/skills\n    path: skills/remote-skill\n    version: 2.1.3\n    commit: abc123\n    integrity: sha256-xyz\n    dependencies: []\n",
		);

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir);
		} finally {
			restore();
		}
		expect(logs.some((l) => l.includes("2.1.3"))).toBe(true);
		expect(logs.some((l) => l.includes("github.com/org/skills"))).toBe(true);
	});
});
