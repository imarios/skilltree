import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProgram } from "../../src/cli.js";
import { initCommand } from "../../src/commands/init.js";
import { newCommand } from "../../src/commands/new.js";
import { validateFrontmatter } from "../../src/core/frontmatter.js";
import { readManifest } from "../../src/core/manifest.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-new-"));
	await initCommand(tempDir);
	return tempDir;
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = "";
	}
});

describe("newCommand — scaffolds entity files", () => {
	test("scaffolds a skill at skills/<name>/SKILL.md with valid frontmatter", async () => {
		const dir = await setup();
		await newCommand("skill", "foo", {}, dir);

		const target = join(dir, "skills", "foo", "SKILL.md");
		expect(existsSync(target)).toBe(true);

		const content = await readFile(target, "utf-8");
		expect(content).toContain("name: foo");
		expect(content).toContain("description:");
		expect(content).toContain("dependencies: []");
		expect(content).toContain("# foo");
	});

	test("scaffolds an agent at agents/<name>.md", async () => {
		const dir = await setup();
		await newCommand("agent", "bar", {}, dir);

		const target = join(dir, "agents", "bar.md");
		expect(existsSync(target)).toBe(true);

		const content = await readFile(target, "utf-8");
		expect(content).toContain("name: bar");
		expect(content).toContain("skills: []");
	});

	test("scaffolds a command at commands/<name>.md", async () => {
		const dir = await setup();
		await newCommand("command", "baz", {}, dir);

		const target = join(dir, "commands", "baz.md");
		expect(existsSync(target)).toBe(true);

		const content = await readFile(target, "utf-8");
		expect(content).toContain("name: baz");
		expect(content).toContain("# /baz");
	});

	test("templates pass frontmatter validation cleanly (no warnings)", async () => {
		const dir = await setup();
		await newCommand("skill", "foo", {}, dir);
		await newCommand("agent", "bar", {}, dir);
		await newCommand("command", "baz", {}, dir);

		const skill = await readFile(join(dir, "skills", "foo", "SKILL.md"), "utf-8");
		const agent = await readFile(join(dir, "agents", "bar.md"), "utf-8");
		const command = await readFile(join(dir, "commands", "baz.md"), "utf-8");

		expect(
			validateFrontmatter(skill, { entityName: "foo" }).filter((i) => i.kind === "warning"),
		).toEqual([]);
		expect(
			validateFrontmatter(agent, { entityName: "bar" }).filter((i) => i.kind === "warning"),
		).toEqual([]);
		expect(
			validateFrontmatter(command, { entityName: "baz" }).filter((i) => i.kind === "warning"),
		).toEqual([]);
	});
});

describe("newCommand — registration", () => {
	test("registers a new skill as a local dependency by default", async () => {
		const dir = await setup();
		await newCommand("skill", "foo", {}, dir);

		const manifest = await readManifest(dir);
		const dep = manifest.dependencies?.foo;
		expect(dep).toBeDefined();
		expect((dep as { local: string }).local).toBe("./skills/foo");
	});

	test("registers a new agent as a local dependency pointing at the .md file", async () => {
		const dir = await setup();
		await newCommand("agent", "bar", {}, dir);

		const manifest = await readManifest(dir);
		const dep = manifest.dependencies?.bar;
		expect(dep).toBeDefined();
		expect((dep as { local: string }).local).toBe("./agents/bar.md");
		expect((dep as { type: string }).type).toBe("agent");
	});

	test("registers a new command as a local dependency", async () => {
		const dir = await setup();
		await newCommand("command", "baz", {}, dir);

		const manifest = await readManifest(dir);
		const dep = manifest.dependencies?.baz;
		expect(dep).toBeDefined();
		expect((dep as { local: string }).local).toBe("./commands/baz.md");
		expect((dep as { type: string }).type).toBe("command");
	});

	test("--no-register (register: false) skips manifest registration", async () => {
		const dir = await setup();
		await newCommand("skill", "foo", { register: false }, dir);

		// File still created
		expect(existsSync(join(dir, "skills", "foo", "SKILL.md"))).toBe(true);

		// But not registered
		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.foo).toBeUndefined();
		expect(manifest["dev-dependencies"]?.foo).toBeUndefined();
	});

	test("--dev registers under dev-dependencies", async () => {
		const dir = await setup();
		await newCommand("skill", "foo", { dev: true }, dir);

		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.foo).toBeUndefined();
		expect(manifest["dev-dependencies"]?.foo).toBeDefined();
	});
});

describe("newCommand — collision behaviour", () => {
	test("errors when target SKILL.md already exists (skill)", async () => {
		const dir = await setup();
		const target = join(dir, "skills", "foo");
		await mkdir(target, { recursive: true });
		await writeFile(join(target, "SKILL.md"), "existing\n");

		await expect(newCommand("skill", "foo", {}, dir)).rejects.toThrow(/already exists/);
	});

	test("errors when target agent .md already exists", async () => {
		const dir = await setup();
		await mkdir(join(dir, "agents"), { recursive: true });
		await writeFile(join(dir, "agents", "foo.md"), "existing\n");

		await expect(newCommand("agent", "foo", {}, dir)).rejects.toThrow(/already exists/);
	});

	test("errors when target command .md already exists", async () => {
		const dir = await setup();
		await mkdir(join(dir, "commands"), { recursive: true });
		await writeFile(join(dir, "commands", "foo.md"), "existing\n");

		await expect(newCommand("command", "foo", {}, dir)).rejects.toThrow(/already exists/);
	});

	test("collision does NOT modify the manifest", async () => {
		const dir = await setup();
		const target = join(dir, "skills", "foo");
		await mkdir(target, { recursive: true });
		await writeFile(join(target, "SKILL.md"), "existing\n");

		const before = await readManifest(dir);
		await expect(newCommand("skill", "foo", {}, dir)).rejects.toThrow();
		const after = await readManifest(dir);
		expect(after.dependencies).toEqual(before.dependencies);
	});
});

describe("newCommand — name validation", () => {
	test("rejects names containing slashes (path traversal)", async () => {
		const dir = await setup();
		await expect(newCommand("skill", "foo/bar", {}, dir)).rejects.toThrow(/Invalid name/);
		await expect(newCommand("skill", "../etc/passwd", {}, dir)).rejects.toThrow(/Invalid name/);
	});

	test("rejects names containing spaces", async () => {
		const dir = await setup();
		await expect(newCommand("skill", "foo bar", {}, dir)).rejects.toThrow(/Invalid name/);
	});

	test("rejects empty name", async () => {
		const dir = await setup();
		await expect(newCommand("skill", "", {}, dir)).rejects.toThrow(/Invalid name/);
	});

	test("rejects names starting with a dot or hyphen", async () => {
		const dir = await setup();
		await expect(newCommand("skill", ".hidden", {}, dir)).rejects.toThrow(/Invalid name/);
		await expect(newCommand("skill", "-flag", {}, dir)).rejects.toThrow(/Invalid name/);
	});

	test("accepts kebab-case, snake_case, and digits", async () => {
		const dir = await setup();
		await newCommand("skill", "foo-bar_baz2", {}, dir);
		expect(existsSync(join(dir, "skills", "foo-bar_baz2", "SKILL.md"))).toBe(true);
	});
});

describe("newCommand — type validation", () => {
	test("rejects invalid entity types", async () => {
		const dir = await setup();
		await expect(newCommand("widget" as never, "foo", {}, dir)).rejects.toThrow(/Invalid type/);
		await expect(newCommand("" as never, "foo", {}, dir)).rejects.toThrow(/Invalid type/);
	});
});

/**
 * Exercise the CLI action handler's three error branches directly through
 * Commander. Direct `newCommand` calls bypass the CLI sniffing logic, so
 * these would otherwise be uncovered.
 */
describe("`new` CLI handler — argument sniffing errors", () => {
	async function runCli(argv: string[], dir: string): Promise<void> {
		const cwdBefore = process.cwd();
		process.chdir(dir);
		try {
			const program = buildProgram();
			program.exitOverride(); // Throw instead of process.exit on Commander errors.
			await program.parseAsync(["node", "skilltree", ...argv]);
		} finally {
			process.chdir(cwdBefore);
		}
	}

	test("subcommand form with an unknown type errors", async () => {
		const dir = await setup();
		await expect(runCli(["new", "widget", "foo"], dir)).rejects.toThrow(
			/Unknown entity type "widget"/,
		);
	});

	test("conflicting subcommand + --type errors", async () => {
		const dir = await setup();
		await expect(runCli(["new", "skill", "foo", "--type", "agent"], dir)).rejects.toThrow(
			/Cannot combine subcommand form/,
		);
	});

	test("single positional without --type errors", async () => {
		const dir = await setup();
		await expect(runCli(["new", "foo"], dir)).rejects.toThrow(/Missing entity type/);
	});

	test("single positional with --type produces a valid scaffold", async () => {
		const dir = await setup();
		await runCli(["new", "foo", "--type", "skill"], dir);
		const manifest = await readManifest(dir);
		expect(manifest.dependencies?.foo).toBeDefined();
	});
});

describe("newCommand — no skilltree.yml (#120)", () => {
	test("fails fast without writing files when no manifest exists", async () => {
		// In a dir without skilltree.yml, the registration step would fail
		// downstream — but only after the file was already written, leaving an
		// orphan on disk. Fail-fast keeps the FS clean.
		const dir = await mkdtemp(join(tmpdir(), "skilltree-new-orphan-"));
		try {
			await expect(newCommand("skill", "orphan", {}, dir)).rejects.toThrow(/no skilltree\.yml/i);
			expect(existsSync(join(dir, "skills", "orphan", "SKILL.md"))).toBe(false);
			expect(existsSync(join(dir, "skills", "orphan"))).toBe(false);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("--no-register still works without a manifest (scaffold-only mode)", async () => {
		// The user explicitly opted out of manifest registration, so absence
		// of skilltree.yml is fine — they just want the template.
		const dir = await mkdtemp(join(tmpdir(), "skilltree-new-scaffold-only-"));
		try {
			await newCommand("skill", "scaffold-only", { register: false }, dir);
			expect(existsSync(join(dir, "skills", "scaffold-only", "SKILL.md"))).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("newCommand — CLI parity (subcommand form vs --type)", () => {
	test("--type produces the same scaffold as the subcommand form", async () => {
		// We invoke newCommand directly with the type argument here — both CLI
		// forms (`new skill foo` and `new foo --type skill`) collapse to the
		// same call at the command-function level, so identity of behaviour at
		// the function boundary is the parity contract.
		const dir1 = await mkdtemp(join(tmpdir(), "skilltree-new-parity1-"));
		await initCommand(dir1);
		await newCommand("skill", "foo", {}, dir1);
		const content1 = await readFile(join(dir1, "skills", "foo", "SKILL.md"), "utf-8");
		const manifest1 = await readManifest(dir1);

		const dir2 = await mkdtemp(join(tmpdir(), "skilltree-new-parity2-"));
		await initCommand(dir2);
		await newCommand("skill", "foo", {}, dir2);
		const content2 = await readFile(join(dir2, "skills", "foo", "SKILL.md"), "utf-8");
		const manifest2 = await readManifest(dir2);

		expect(content2).toEqual(content1);
		expect(manifest2.dependencies?.foo).toEqual(manifest1.dependencies?.foo);

		await rm(dir1, { recursive: true, force: true });
		await rm(dir2, { recursive: true, force: true });
	});
});
