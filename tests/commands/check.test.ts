import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCommand } from "../../src/commands/check.js";
import { validateFrontmatter } from "../../src/core/frontmatter.js";
import type { EntityType } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Filesystem fixtures
// ---------------------------------------------------------------------------

let tempDir: string;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function makeProject(opts: {
	manifest: string;
	files?: Array<{ path: string; content: string }>;
}): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-check-frontmatter-"));
	await writeFile(join(tempDir, "skilltree.yml"), opts.manifest, "utf-8");
	for (const f of opts.files ?? []) {
		const full = join(tempDir, f.path);
		await mkdir(join(full, ".."), { recursive: true });
		await writeFile(full, f.content, "utf-8");
	}
	return tempDir;
}

function captureOutput(): {
	logs: string[];
	warns: string[];
	errors: string[];
	restore: () => void;
} {
	const logs: string[] = [];
	const warns: string[] = [];
	const errors: string[] = [];
	const origLog = console.log;
	const origWarn = console.warn;
	const origError = console.error;
	console.log = (msg: string) => {
		logs.push(typeof msg === "string" ? msg : String(msg));
	};
	console.warn = (msg: string) => {
		warns.push(typeof msg === "string" ? msg : String(msg));
	};
	console.error = (msg: string) => {
		errors.push(typeof msg === "string" ? msg : String(msg));
	};
	return {
		logs,
		warns,
		errors,
		restore: () => {
			console.log = origLog;
			console.warn = origWarn;
			console.error = origError;
		},
	};
}

async function runCheck(
	dir: string,
	opts: { strict?: boolean } = {},
): Promise<{
	logs: string[];
	warns: string[];
	errors: string[];
	exitCode: number | undefined;
}> {
	const cap = captureOutput();
	const origExit = process.exit;
	let exitCode: number | undefined;
	process.exit = ((c: number) => {
		exitCode = c;
		throw new Error(`exit ${c}`);
	}) as typeof process.exit;
	try {
		await checkCommand(dir, opts);
	} catch (e) {
		if (!(e instanceof Error && /^exit/.test(e.message))) throw e;
	} finally {
		process.exit = origExit;
		cap.restore();
	}
	return { logs: cap.logs, warns: cap.warns, errors: cap.errors, exitCode };
}

const skillManifest = (extra = "") =>
	["name: test", "dependencies:", "  foo:", "    local: ./skills/foo", "    type: skill", extra, ""]
		.filter(Boolean)
		.join("\n");

const skillFm = (body: string) => ({
	path: "skills/foo/SKILL.md",
	content: `---\n${body}\n---\n\n# foo\n`,
});

// ---------------------------------------------------------------------------
// validateFrontmatter — unit-level checks of the helper
// ---------------------------------------------------------------------------

describe("validateFrontmatter", () => {
	test("clean SKILL.md passes silently", () => {
		const content = `---\nname: foo\ndescription: A good skill\n---\n`;
		expect(validateFrontmatter(content, { entityName: "foo" })).toEqual([]);
	});

	test("missing frontmatter is flagged", () => {
		const issues = validateFrontmatter("# Just markdown\n", { entityName: "foo" });
		expect(issues.length).toBe(1);
		expect(issues[0]?.kind).toBe("warning");
		expect(issues[0]?.message).toMatch(/missing frontmatter/);
	});

	test("missing required field 'name' is a warning", () => {
		const content = `---\ndescription: A skill\n---\n`;
		const issues = validateFrontmatter(content, { entityName: "foo" });
		const messages = issues.map((i) => i.message);
		expect(issues.some((i) => i.kind === "warning")).toBe(true);
		expect(messages.some((m) => m.includes("missing required field 'name'"))).toBe(true);
	});

	test("missing required field 'description' is a warning", () => {
		const content = `---\nname: foo\n---\n`;
		const issues = validateFrontmatter(content, { entityName: "foo" });
		expect(issues.some((i) => i.message.includes("missing required field 'description'"))).toBe(
			true,
		);
	});

	test("name mismatch with manifest key is a warning", () => {
		const content = `---\nname: bar\ndescription: A skill\n---\n`;
		const issues = validateFrontmatter(content, { entityName: "foo" });
		const msg = issues.map((i) => i.message).join("\n");
		expect(msg).toMatch(/'name'.*"bar".*"foo"/);
	});

	test("invalid semver in version is a warning", () => {
		const content = `---\nname: foo\ndescription: x\nversion: not-a-semver\n---\n`;
		const issues = validateFrontmatter(content, { entityName: "foo" });
		expect(issues.some((i) => i.kind === "warning" && i.message.includes("not valid semver"))).toBe(
			true,
		);
	});

	test("version 1.x.y.z (four-part) is rejected", () => {
		const content = `---\nname: foo\ndescription: x\nversion: 1.0.0.0\n---\n`;
		const issues = validateFrontmatter(content, { entityName: "foo" });
		expect(issues.some((i) => i.message.includes("not valid semver"))).toBe(true);
	});

	test("valid semver version passes", () => {
		const content = `---\nname: foo\ndescription: x\nversion: 1.2.3\n---\n`;
		expect(validateFrontmatter(content, { entityName: "foo" })).toEqual([]);
	});

	test("non-string version is a warning", () => {
		const content = `---\nname: foo\ndescription: x\nversion: 123\n---\n`;
		const issues = validateFrontmatter(content, { entityName: "foo" });
		expect(issues.some((i) => i.message.includes("not valid semver"))).toBe(true);
	});

	test("'dependencies' as array of strings passes", () => {
		const content = `---\nname: foo\ndescription: x\ndependencies:\n  - a\n  - b\n---\n`;
		expect(validateFrontmatter(content, { entityName: "foo" })).toEqual([]);
	});

	test("'dependencies' as string is rejected", () => {
		const content = `---\nname: foo\ndescription: x\ndependencies: "a, b"\n---\n`;
		const issues = validateFrontmatter(content, { entityName: "foo" });
		expect(issues.some((i) => i.kind === "warning" && i.message.includes("'dependencies'"))).toBe(
			true,
		);
	});

	test("'dependencies' with non-string entry is rejected", () => {
		const content = `---\nname: foo\ndescription: x\ndependencies:\n  - a\n  - 123\n---\n`;
		const issues = validateFrontmatter(content, { entityName: "foo" });
		expect(issues.some((i) => i.message.includes("'dependencies'"))).toBe(true);
	});

	test("'skills' as YAML array of strings passes", () => {
		const content = `---\nname: foo\ndescription: x\nskills:\n  - a\n  - b\n---\n`;
		expect(validateFrontmatter(content, { entityName: "foo" })).toEqual([]);
	});

	test("'skills' as comma-separated string passes", () => {
		const content = `---\nname: foo\ndescription: x\nskills: a, b\n---\n`;
		expect(validateFrontmatter(content, { entityName: "foo" })).toEqual([]);
	});

	test("'skills' as a number is rejected", () => {
		const content = `---\nname: foo\ndescription: x\nskills: 123\n---\n`;
		const issues = validateFrontmatter(content, { entityName: "foo" });
		expect(issues.some((i) => i.kind === "warning" && i.message.includes("'skills'"))).toBe(true);
	});

	test("unknown key 'agents' is a hard error (#124)", () => {
		// Pre-#124 this was a `note`. The summary "✔ No issues." then
		// contradicted the per-file unknown-key line, and broken frontmatter
		// passed `check` while failing at `install`.
		const content = `---\nname: foo\ndescription: x\nagents: []\n---\n`;
		const issues = validateFrontmatter(content, { entityName: "foo" });
		const agentsIssues = issues.filter((i) => i.message.includes("agents"));
		expect(agentsIssues.length).toBe(1);
		expect(agentsIssues[0]?.kind).toBe("error");
	});

	test("malformed YAML in frontmatter is a hard error (#124)", () => {
		const content = `---\nname: foo\n  : invalid\n---\n`;
		const issues = validateFrontmatter(content, { entityName: "foo" });
		expect(issues.some((i) => i.kind === "error")).toBe(true);
	});

	test("frontmatter that is not a mapping is a hard error (#124)", () => {
		const content = `---\n- just\n- a list\n---\n`;
		const issues = validateFrontmatter(content, { entityName: "foo" });
		expect(issues.some((i) => i.kind === "error")).toBe(true);
	});

	test("missing closing --- is a hard error (#124)", () => {
		const content = `---\nname: foo\ndescription: x\n`;
		const issues = validateFrontmatter(content, { entityName: "foo" });
		expect(issues.some((i) => i.kind === "error")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Per-entity-type known keys (#159, #160)
//
// The known-key set used to be one flat list of the five fields skilltree
// itself reads, applied identically to skills, agents, and commands. Every
// other valid Claude Code frontmatter key was therefore a hard error: authors
// had to choose between least-privilege `tools:` / model pinning on an agent
// and a clean `check`. Keys are now scoped to the entity type.
// ---------------------------------------------------------------------------

describe("validateFrontmatter — per-entity-type keys", () => {
	const fm = (body: string) => `---\nname: foo\ndescription: x\n${body}\n---\n`;
	const unknownKeys = (content: string, entityType?: EntityType) =>
		validateFrontmatter(content, { entityName: "foo", entityType })
			.filter((i) => i.message.includes("unknown frontmatter key"))
			.map((i) => i.field);

	// Each row: entity type (undefined = caller couldn't classify the file),
	// frontmatter body, and the keys that must be reported unknown.
	// Adding a supported key means adding a row, not a test.
	const cases: Array<[string, EntityType | undefined, string, string[]]> = [
		// #160 — the documented skill anatomy calls for `metadata`.
		["skill accepts metadata", "skill", "metadata:\n  author: a@example.com\n  version: 0.1.0", []],
		[
			"skill accepts license + allowed-tools",
			"skill",
			"license: MIT\nallowed-tools: Read, Grep",
			[],
		],
		// #159 — least-privilege tool access and per-agent model pinning.
		["agent accepts tools + model", "agent", "tools: Write, ToolSearch\nmodel: sonnet", []],
		["agent accepts color", "agent", "color: blue", []],
		[
			"command accepts argument-hint + allowed-tools",
			"command",
			"argument-hint: <issue-id>\nallowed-tools: Bash(git:*)",
			[],
		],
		["command accepts disable-model-invocation", "command", "disable-model-invocation: true", []],

		// Keys skilltree itself reads are valid everywhere.
		...(["skill", "agent", "command"] as const).map(
			(type): [string, EntityType, string, string[]] => [
				`${type} accepts skilltree's own keys`,
				type,
				"version: 1.0.0\ndependencies:\n  - a\nskills: b, c\nmetadata:\n  x: y",
				[],
			],
		),

		// Typos and misplaced keys still error — that's the point of the lint.
		...(["skill", "agent", "command"] as const).map(
			(type): [string, EntityType, string, string[]] => [
				`${type} rejects an unrecognized key`,
				type,
				"bogus: nope",
				["bogus"],
			],
		),
		["skill rejects agent-only keys", "skill", "tools: Read", ["tools"]],
		["agent rejects command-only keys", "agent", "argument-hint: <id>", ["argument-hint"]],
		["command rejects agent-only keys", "command", "tools: Read", ["tools"]],

		// No type resolved — the file isn't a recognized entity shape, so the
		// union is accepted rather than picking a side and erroring on valid input.
		["untyped accepts any type's keys", undefined, "tools: Read\nargument-hint: <id>", []],
		["untyped still rejects unrecognized keys", undefined, "bogus: nope", ["bogus"]],
	];

	test.each(cases)("%s", (_label, entityType, body, expected) => {
		expect(unknownKeys(fm(body), entityType)).toEqual(expected);
	});

	test("unrecognized keys are hard errors, not warnings or notes", () => {
		const issues = validateFrontmatter(fm("bogus: nope"), {
			entityName: "foo",
			entityType: "skill",
		});
		expect(issues.filter((i) => i.field === "bogus").map((i) => i.kind)).toEqual(["error"]);
	});
});

// ---------------------------------------------------------------------------
// checkCommand end-to-end — frontmatter lint behaviour
// ---------------------------------------------------------------------------

describe("checkCommand frontmatter lint", () => {
	test("clean local skill passes silently", async () => {
		const dir = await makeProject({
			manifest: skillManifest(),
			files: [skillFm("name: foo\ndescription: ok")],
		});

		const { logs, warns, exitCode } = await runCheck(dir);
		expect(warns).toEqual([]);
		expect(logs.join("\n")).toContain("No issues");
		expect(exitCode).toBeUndefined();
	});

	test("missing 'name' warns; --strict exits 1", async () => {
		const dir = await makeProject({
			manifest: skillManifest(),
			files: [skillFm("description: ok")],
		});

		const plain = await runCheck(dir);
		expect(plain.warns.join("\n")).toMatch(/missing required field 'name'/);
		expect(plain.exitCode).toBeUndefined();

		const strict = await runCheck(dir, { strict: true });
		expect(strict.exitCode).toBe(1);
	});

	test("invalid semver version exits 1 under --strict", async () => {
		const dir = await makeProject({
			manifest: skillManifest(),
			files: [skillFm("name: foo\ndescription: x\nversion: 1.x.y.z")],
		});

		const strict = await runCheck(dir, { strict: true });
		expect(strict.warns.join("\n")).toMatch(/not valid semver/);
		expect(strict.exitCode).toBe(1);
	});

	test("'skills: [a, b]' passes silently", async () => {
		const dir = await makeProject({
			manifest: skillManifest(),
			files: [skillFm("name: foo\ndescription: x\nskills:\n  - a\n  - b")],
		});

		const { warns, logs, exitCode } = await runCheck(dir);
		expect(warns).toEqual([]);
		expect(logs.join("\n")).toContain("No issues");
		expect(exitCode).toBeUndefined();
	});

	test("unknown frontmatter key fails by default (#124)", async () => {
		// Pre-#124: unknown keys were dim notes that never gated. The summary
		// "✔ No issues." contradicted the per-file detail line. Post-#124 the
		// same input exits 1 with no `--strict` needed — same shape as install.
		const dir = await makeProject({
			manifest: skillManifest(),
			files: [skillFm("name: foo\ndescription: x\nagents: []")],
		});

		const plain = await runCheck(dir);
		expect(plain.exitCode).toBe(1);
		const allOut = [...plain.logs, ...plain.warns, ...plain.errors].join("\n");
		expect(allOut).toMatch(/agents/);
	});

	test("local path pointing at non-existent file errors out", async () => {
		const dir = await makeProject({
			manifest: skillManifest(),
			// Intentionally do NOT create skills/foo/SKILL.md
		});

		const strict = await runCheck(dir, { strict: true });
		const allOut = [...strict.logs, ...strict.warns].join("\n");
		expect(allOut).toMatch(/local path does not exist/);
		expect(strict.exitCode).toBe(1);
	});

	test("remote dependencies are skipped by the lint", async () => {
		// Remote dep with no local file; should not emit frontmatter warnings
		// (resolution will likely warn/error for the missing repo, but the
		// frontmatter lint itself must not fabricate a "missing frontmatter"
		// against a non-existent local file for a remote entity).
		const dir = await makeProject({
			manifest: [
				"name: test",
				"dependencies:",
				"  remote-thing:",
				"    repo: file:///nonexistent/repo",
				"    path: skills/remote-thing",
				"",
			].join("\n"),
		});

		const { warns, logs } = await runCheck(dir).catch(() => ({
			warns: [] as string[],
			logs: [] as string[],
		}));
		const allOut = [...logs, ...warns].join("\n");
		// The frontmatter lint must not complain about a SKILL.md path under
		// a remote dep's local path (since there is none).
		expect(allOut).not.toMatch(/skills\/remote-thing\/SKILL\.md/);
	});

	test("agent .md missing description is flagged", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-check-frontmatter-"));
		await writeFile(
			join(tempDir, "skilltree.yml"),
			[
				"name: test",
				"dependencies:",
				"  my-agent:",
				"    local: ./agents/my-agent.md",
				"    type: agent",
				"",
			].join("\n"),
			"utf-8",
		);
		await mkdir(join(tempDir, "agents"), { recursive: true });
		await writeFile(
			join(tempDir, "agents/my-agent.md"),
			`---\nname: my-agent\n---\n\n# my-agent\n`,
			"utf-8",
		);

		const { warns, exitCode } = await runCheck(tempDir, { strict: true });
		expect(warns.join("\n")).toMatch(/missing required field 'description'/);
		expect(exitCode).toBe(1);
	});

	// #159 (`tools`/`model` on an agent — least-privilege tool access and
	// per-agent model pinning) and #160 (`metadata` on a skill, which the
	// documented skill anatomy calls for). Each of these was a hard error, so
	// authors had to choose between a functionally correct entity and a
	// `check` that exits 0.
	const validFrontmatterCases: Array<[EntityType, string, string]> = [
		["skill", "skills/foo/SKILL.md", "metadata:\n  author: a@example.com\n  version: 0.1.0"],
		["agent", "agents/foo.md", "tools: Write, ToolSearch\nmodel: sonnet\nskills:\n  - a-contract"],
		["command", "commands/foo.md", "argument-hint: <issue-id>\nallowed-tools: Bash(git:*)"],
	];

	test.each(validFrontmatterCases)(
		"%s with host-runtime frontmatter keys passes check (#159, #160)",
		async (type, path, extraKeys) => {
			const localPath = type === "skill" ? "./skills/foo" : `./${path}`;
			const dir = await makeProject({
				manifest: [
					"name: test",
					"dependencies:",
					"  foo:",
					`    local: ${localPath}`,
					`    type: ${type}`,
					"",
				].join("\n"),
				files: [{ path, content: `---\nname: foo\ndescription: x\n${extraKeys}\n---\n\n# foo\n` }],
			});

			const { logs, warns, errors, exitCode } = await runCheck(dir);
			expect([...logs, ...warns, ...errors].join("\n")).not.toMatch(/unknown frontmatter key/);
			expect(logs.join("\n")).toContain("No issues");
			expect(exitCode).toBeUndefined();
		},
	);

	// The type is inferred from the path when the manifest doesn't declare it,
	// using the same `mdFileType` probe the install path uses — so `check` and
	// `install` can never disagree about what a given file is.
	test("undeclared type is inferred from the path", async () => {
		const dir = await makeProject({
			manifest: ["name: test", "dependencies:", "  foo:", "    local: ./commands/foo.md", ""].join(
				"\n",
			),
			files: [
				{
					path: "commands/foo.md",
					content: `---\nname: foo\ndescription: x\nargument-hint: <id>\n---\n\n# /foo\n`,
				},
			],
		});

		const { logs, errors, exitCode } = await runCheck(dir);
		expect([...logs, ...errors].join("\n")).not.toMatch(/unknown frontmatter key/);
		expect(exitCode).toBeUndefined();
	});

	test("dev-dependencies are linted too", async () => {
		const dir = await makeProject({
			manifest: [
				"name: test",
				"dev-dependencies:",
				"  foo:",
				"    local: ./skills/foo",
				"    type: skill",
				"",
			].join("\n"),
			files: [skillFm("description: x")], // missing name
		});

		const { warns, exitCode } = await runCheck(dir, { strict: true });
		expect(warns.join("\n")).toMatch(/missing required field 'name'/);
		expect(exitCode).toBe(1);
	});

	test("output includes file path of the offending entity", async () => {
		const dir = await makeProject({
			manifest: skillManifest(),
			files: [skillFm("description: x")],
		});

		const { warns } = await runCheck(dir);
		expect(warns.join("\n")).toMatch(/skills\/foo\/SKILL\.md/);
	});

	test("name override via manifest `name:` field is honored", async () => {
		// Manifest key is `foo-alias`, but `name:` says `foo` — the SKILL.md
		// must match the resolved entity name (foo), not the alias.
		const dir = await makeProject({
			manifest: [
				"name: test",
				"dependencies:",
				"  foo-alias:",
				"    local: ./skills/foo",
				"    type: skill",
				"    name: foo",
				"",
			].join("\n"),
			files: [skillFm("name: foo\ndescription: x")],
		});

		const { warns, logs, exitCode } = await runCheck(dir);
		expect(warns).toEqual([]);
		expect(logs.join("\n")).toContain("No issues");
		expect(exitCode).toBeUndefined();
	});
});
