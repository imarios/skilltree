// Tests for `collectCheckIssues` — the pure, callable extraction of
// `checkCommand`'s lint logic. Doctor (Nitrogen Phase 2) calls this directly
// instead of re-running the CLI. See docs/planning/nitrogen/phase_1/.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectCheckIssues } from "../../src/commands/check.js";
import { loadManifestOrThrow } from "../../src/core/manifest.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function makeProject(opts: {
	manifest: string;
	files?: Array<{ path: string; content: string }>;
}): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-collect-check-"));
	await writeFile(join(tempDir, "skilltree.yml"), opts.manifest, "utf-8");
	for (const f of opts.files ?? []) {
		const full = join(tempDir, f.path);
		await mkdir(join(full, ".."), { recursive: true });
		await writeFile(full, f.content, "utf-8");
	}
	return tempDir;
}

describe("collectCheckIssues", () => {
	test("clean project with no dependencies returns empty summary", async () => {
		const dir = await makeProject({
			manifest: "name: clean\ndependencies: {}\n",
		});
		const manifest = await loadManifestOrThrow(dir);
		const summary = await collectCheckIssues(manifest, dir);
		expect(summary.lint).toEqual([]);
		expect(summary.frontmatterWarnings).toEqual([]);
		expect(summary.frontmatterNotes).toEqual([]);
	});

	test("asymmetric publish leak is reported in `lint`", async () => {
		const dir = await makeProject({
			manifest: [
				"name: leak",
				"dependencies:",
				"  root:",
				"    local: ./skills/root",
				"    type: skill",
				"  leaf:",
				"    local: ./skills/leaf",
				"    type: skill",
				"    publish: false",
				"",
			].join("\n"),
			files: [
				{
					path: "skills/root/SKILL.md",
					content:
						"---\nname: root\ndescription: A root skill\ndependencies:\n  - leaf\n---\n\n# root\n",
				},
				{
					path: "skills/leaf/SKILL.md",
					content: "---\nname: leaf\ndescription: A leaf skill\n---\n\n# leaf\n",
				},
			],
		});
		const manifest = await loadManifestOrThrow(dir);
		const summary = await collectCheckIssues(manifest, dir);
		// One leaking root → one warning.
		expect(summary.lint.length).toBe(1);
		const joined = summary.lint.join("\n");
		expect(joined).toContain("root");
		expect(joined).toContain("leaf");
		// Frontmatter is clean.
		expect(summary.frontmatterWarnings).toEqual([]);
	});

	test("malformed SKILL.md is reported in `frontmatterWarnings`", async () => {
		const dir = await makeProject({
			manifest: [
				"name: bad-frontmatter",
				"dependencies:",
				"  foo:",
				"    local: ./skills/foo",
				"    type: skill",
				"",
			].join("\n"),
			files: [
				{
					path: "skills/foo/SKILL.md",
					// Missing `name` — frontmatter lint flags it.
					content: "---\ndescription: missing name\n---\n\n# foo\n",
				},
			],
		});
		const manifest = await loadManifestOrThrow(dir);
		const summary = await collectCheckIssues(manifest, dir);
		expect(summary.frontmatterWarnings.length).toBeGreaterThan(0);
		const joined = summary.frontmatterWarnings.join("\n");
		expect(joined).toContain("name");
		// Lint should be clean — no publish-leak in this fixture.
		expect(summary.lint).toEqual([]);
	});

	test("notes and warnings are surfaced on separate channels", async () => {
		// `agents:` is an unknown key — produces a *note* (kind: "note"),
		// not a warning. The split lets doctor count only the warning side.
		const dir = await makeProject({
			manifest: [
				"name: note-only",
				"dependencies:",
				"  foo:",
				"    local: ./skills/foo",
				"    type: skill",
				"",
			].join("\n"),
			files: [
				{
					path: "skills/foo/SKILL.md",
					content: "---\nname: foo\ndescription: x\nagents: []\n---\n\n# foo\n",
				},
			],
		});
		const manifest = await loadManifestOrThrow(dir);
		const summary = await collectCheckIssues(manifest, dir);
		expect(summary.frontmatterWarnings).toEqual([]);
		expect(summary.frontmatterNotes.length).toBeGreaterThan(0);
		expect(summary.frontmatterNotes.join("\n")).toContain("agents");
	});
});
