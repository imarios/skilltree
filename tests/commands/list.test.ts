import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCommand } from "../../src/commands/list.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("listCommand", () => {
	test("throws when no skilltree.yaml exists", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		await expect(listCommand(tempDir)).rejects.toThrow("No skilltree.yaml");
	});

	test("shows empty message when manifest exists but no lockfile", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		await writeFile(join(tempDir, "skilltree.yaml"), "name: test\n");

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (msg: string) => logs.push(msg);
		try {
			await listCommand(tempDir);
		} finally {
			console.log = originalLog;
		}
		expect(logs.some((l) => l.includes("No dependencies installed"))).toBe(true);
	});

	test("lists installed dependencies from lockfile", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		await writeFile(join(tempDir, "skilltree.yaml"), "name: test\n");
		await writeFile(
			join(tempDir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  my-skill:\n    type: skill\n    group: prod\n    source: local\n    path: ./skills/my-skill\n    commit: HEAD\n    dependencies: []\n",
		);

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (msg: string) => logs.push(msg);
		try {
			await listCommand(tempDir);
		} finally {
			console.log = originalLog;
		}
		expect(logs.some((l) => l.includes("my-skill"))).toBe(true);
		expect(logs.some((l) => l.includes("skill"))).toBe(true);
	});
});
