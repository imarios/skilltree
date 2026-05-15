import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vendorCommand } from "../../src/commands/vendor.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

let tempDir: string;

async function makeTempDir(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-vendor-publish-"));
	return tempDir;
}

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("vendor — publish:false filtering (Carbon Phase 3)", () => {
	test("skips publish:false local entities", async () => {
		const dir = await makeTempDir();
		await writeFile(
			join(dir, "skilltree.yml"),
			`name: test
dev_install_path: .claude
dependencies:
  ready:
    local: ./skills/ready
  wip:
    local: ./skills/wip
    publish: false
`,
		);
		await writeFile(join(dir, ".gitignore"), ".claude/skills/\n.claude/agents/\n");
		await createLocalSkill(join(dir, "skills"), "ready");
		await createLocalSkill(join(dir, "skills"), "wip");

		await vendorCommand(dir, {});

		expect(existsSync(join(dir, ".claude/skills/ready"))).toBe(true);
		expect(existsSync(join(dir, ".claude/skills/wip"))).toBe(false);
	});

	test("keeps dev-dependencies (today's vendor behavior preserved)", async () => {
		const dir = await makeTempDir();
		await writeFile(
			join(dir, "skilltree.yml"),
			`name: test
dev_install_path: .claude
dependencies:
  prod:
    local: ./skills/prod
dev-dependencies:
  internal:
    local: ./skills/internal
`,
		);
		await writeFile(join(dir, ".gitignore"), ".claude/skills/\n.claude/agents/\n");
		await createLocalSkill(join(dir, "skills"), "prod");
		await createLocalSkill(join(dir, "skills"), "internal");

		await vendorCommand(dir, {});

		expect(existsSync(join(dir, ".claude/skills/prod"))).toBe(true);
		expect(existsSync(join(dir, ".claude/skills/internal"))).toBe(true);
	});

	test("honors per-entity exclude during vendor copy", async () => {
		const dir = await makeTempDir();
		await writeFile(
			join(dir, "skilltree.yml"),
			`name: test
dev_install_path: .claude
dependencies:
  foo:
    local: ./skills/foo
    exclude:
      - "experiments/"
`,
		);
		await writeFile(join(dir, ".gitignore"), ".claude/skills/\n.claude/agents/\n");
		await createLocalSkill(join(dir, "skills"), "foo");
		// Add an experiments dir inside foo
		await writeFile(join(dir, "skills/foo/experiments/x.md"), "scratch\n", "utf-8").catch(
			async () => {
				const { mkdir } = await import("node:fs/promises");
				await mkdir(join(dir, "skills/foo/experiments"), { recursive: true });
				await writeFile(join(dir, "skills/foo/experiments/x.md"), "scratch\n", "utf-8");
			},
		);

		await vendorCommand(dir, {});

		expect(existsSync(join(dir, ".claude/skills/foo/SKILL.md"))).toBe(true);
		expect(existsSync(join(dir, ".claude/skills/foo/experiments"))).toBe(false);
	});
});
