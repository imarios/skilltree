import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeBundledSkill } from "../../src/core/bundled-skill.js";

describe("materializeBundledSkill", () => {
	test("writes SKILL.md and references into a fresh target dir", async () => {
		const dir = await mkdtemp(join(tmpdir(), "skilltree-bundled-"));
		try {
			const target = join(dir, "out");
			const result = await materializeBundledSkill(target);
			expect(result).toBe(target);

			const skill = await readFile(join(target, "SKILL.md"), "utf-8");
			expect(skill).toContain("name: skilltree");

			const commands = await readFile(join(target, "references", "commands.md"), "utf-8");
			expect(commands.length).toBeGreaterThan(0);

			const workflows = await readFile(join(target, "references", "workflows.md"), "utf-8");
			expect(workflows.length).toBeGreaterThan(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("overwrites existing files on re-run", async () => {
		const dir = await mkdtemp(join(tmpdir(), "skilltree-bundled-"));
		try {
			const target = join(dir, "out");
			await materializeBundledSkill(target);
			await materializeBundledSkill(target); // should not throw

			const skill = await readFile(join(target, "SKILL.md"), "utf-8");
			expect(skill).toContain("name: skilltree");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
