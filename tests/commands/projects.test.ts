import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectsCommand } from "../../src/commands/projects.js";

let tempDir: string;
let logs: string[];
let warns: string[];
let originalLog: typeof console.log;
let originalWarn: typeof console.warn;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-projects-"));
	logs = [];
	warns = [];
	originalLog = console.log;
	originalWarn = console.warn;
	console.log = (...args: unknown[]) => logs.push(args.join(" "));
	console.warn = (...args: unknown[]) => warns.push(args.join(" "));
});

afterEach(async () => {
	console.log = originalLog;
	console.warn = originalWarn;
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function writeManifest(dir: string, content: string, filename = "skilltree.yml") {
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, filename), content);
}

describe("projectsCommand", () => {
	test("finds nested projects under --root", async () => {
		await writeManifest(join(tempDir, "a"), "name: a\n");
		await writeManifest(join(tempDir, "deep", "b"), "name: b\n");

		await projectsCommand({ root: tempDir, json: true });

		const out = JSON.parse(logs[0] ?? "[]");
		expect(out).toHaveLength(2);
		const paths = (out as Array<{ path: string }>).map((p) => p.path).sort();
		expect(paths[0]).toContain("/a");
		expect(paths[1]).toContain("/deep/b");
	});

	test("respects --root and does not look outside it", async () => {
		const sub = join(tempDir, "inside");
		await writeManifest(sub, "name: in\n");
		// Sibling manifest outside the requested root — must not be returned.
		const outsideRoot = await mkdtemp(join(tmpdir(), "skilltree-outside-"));
		try {
			await writeManifest(outsideRoot, "name: out\n");

			await projectsCommand({ root: sub, json: true });

			const out = JSON.parse(logs[0] ?? "[]") as Array<{ path: string }>;
			expect(out).toHaveLength(1);
			expect(out[0]?.path).toBe(sub);
		} finally {
			await rm(outsideRoot, { recursive: true, force: true });
		}
	});

	test("skips node_modules, .git, dist, build, and .skilltree/cache", async () => {
		// One real project at the root, and "fake" projects inside ignored dirs.
		await writeManifest(tempDir, "name: real\n");
		await writeManifest(join(tempDir, "node_modules", "pkg"), "name: nm\n");
		await writeManifest(join(tempDir, ".git", "hooks"), "name: git\n");
		await writeManifest(join(tempDir, "dist"), "name: dist\n");
		await writeManifest(join(tempDir, "build"), "name: build\n");
		await writeManifest(join(tempDir, ".skilltree", "cache", "x"), "name: cache\n");

		await projectsCommand({ root: tempDir, json: true });

		const out = JSON.parse(logs[0] ?? "[]") as Array<{ path: string }>;
		expect(out).toHaveLength(1);
		expect(out[0]?.path).toBe(tempDir);
	});

	test("descends into .claude but not other hidden dirs", async () => {
		await writeManifest(join(tempDir, ".claude", "proj"), "name: in-claude\n");
		await writeManifest(join(tempDir, ".hidden", "proj"), "name: in-hidden\n");

		await projectsCommand({ root: tempDir, json: true });

		const out = JSON.parse(logs[0] ?? "[]") as Array<{ path: string }>;
		expect(out).toHaveLength(1);
		expect(out[0]?.path).toContain(".claude/proj");
	});

	test("recognises both skilltree.yml and skilltree.yaml", async () => {
		await writeManifest(join(tempDir, "yml"), "name: a\n", "skilltree.yml");
		await writeManifest(join(tempDir, "yaml"), "name: b\n", "skilltree.yaml");

		await projectsCommand({ root: tempDir, json: true });

		const out = JSON.parse(logs[0] ?? "[]") as Array<{
			path: string;
			manifestPath: string;
		}>;
		expect(out).toHaveLength(2);
		const manifestPaths = out.map((p) => p.manifestPath).sort();
		expect(manifestPaths[0]).toContain("yaml/skilltree.yaml");
		expect(manifestPaths[1]).toContain("yml/skilltree.yml");
	});

	test("counts dependencies + dev-dependencies", async () => {
		const manifest = [
			"name: counted",
			"dependencies:",
			"  alpha:",
			"    repo: github.com/x/a",
			"  beta:",
			"    repo: github.com/x/b",
			"dev-dependencies:",
			"  gamma:",
			"    repo: github.com/x/g",
			"",
		].join("\n");
		await writeManifest(tempDir, manifest);

		await projectsCommand({ root: tempDir, json: true });

		const out = JSON.parse(logs[0] ?? "[]") as Array<{ deps: number }>;
		expect(out).toHaveLength(1);
		expect(out[0]?.deps).toBe(3);
	});

	test("reports vendor flag", async () => {
		await writeManifest(join(tempDir, "vendored"), "name: v\nvendor: true\n");
		await writeManifest(join(tempDir, "regular"), "name: r\n");

		await projectsCommand({ root: tempDir, json: true });

		const out = JSON.parse(logs[0] ?? "[]") as Array<{
			path: string;
			vendor: boolean;
		}>;
		const byPath = new Map(out.map((p) => [p.path, p.vendor]));
		expect(byPath.get(join(tempDir, "vendored"))).toBe(true);
		expect(byPath.get(join(tempDir, "regular"))).toBe(false);
	});

	test("reports lockfile mtime as ISO when present, null otherwise", async () => {
		await writeManifest(join(tempDir, "withlock"), "name: wl\n");
		const fixedTime = new Date("2026-01-01T12:00:00Z");
		await writeFile(join(tempDir, "withlock", "skilltree.lock"), "lockfile_version: 1\n");
		await utimes(join(tempDir, "withlock", "skilltree.lock"), fixedTime, fixedTime);

		await writeManifest(join(tempDir, "nolock"), "name: nl\n");

		await projectsCommand({ root: tempDir, json: true });

		const out = JSON.parse(logs[0] ?? "[]") as Array<{
			path: string;
			lastInstall: string | null;
		}>;
		const byPath = new Map(out.map((p) => [p.path, p.lastInstall]));
		expect(byPath.get(join(tempDir, "withlock"))).toBe(fixedTime.toISOString());
		expect(byPath.get(join(tempDir, "nolock"))).toBeNull();
	});

	test("skips unparseable manifests with a single warning per path", async () => {
		await writeManifest(join(tempDir, "ok"), "name: ok\n");
		// `[invalid: : :` opens a YAML flow sequence with a stray `:` — yaml's
		// parser raises on this, so parseManifest should throw and the row
		// should be dropped with exactly one warning.
		await writeManifest(join(tempDir, "broken"), "  [invalid: : :\n  - this\n -is\n :bad");

		await projectsCommand({ root: tempDir, json: true });

		const out = JSON.parse(logs[0] ?? "[]") as Array<{ path: string }>;
		expect(out).toHaveLength(1);
		expect(out[0]?.path).toBe(join(tempDir, "ok"));
		// Exactly one warning mentioning the broken path
		const brokenWarnings = warns.filter((w) => w.includes("broken"));
		expect(brokenWarnings.length).toBe(1);
	});

	test("terminates on symlink cycles", async () => {
		await writeManifest(tempDir, "name: root\n");
		await mkdir(join(tempDir, "child"));
		// Cycle: child/loop -> child (which contains loop -> ...)
		await symlink(join(tempDir, "child"), join(tempDir, "child", "loop"));

		// If the walk doesn't detect cycles, this hangs / blows the call stack.
		await projectsCommand({ root: tempDir, json: true });

		const out = JSON.parse(logs[0] ?? "[]") as Array<{ path: string }>;
		expect(out).toHaveLength(1);
		expect(out[0]?.path).toBe(tempDir);
	});

	test("table output includes header row and project rows", async () => {
		await writeManifest(tempDir, "name: t\n");

		await projectsCommand({ root: tempDir }); // no --json

		const all = logs.join("\n");
		expect(all).toContain("Path");
		expect(all).toContain("Deps");
		expect(all).toContain("Vendor");
		expect(all).toContain("Last install");
	});

	test("empty walk prints a friendly message in table mode and [] in JSON mode", async () => {
		await projectsCommand({ root: tempDir, json: true });
		expect(logs[0]).toBe("[]");

		logs.length = 0;
		await projectsCommand({ root: tempDir });
		expect(logs.some((l) => l.toLowerCase().includes("no skilltree projects"))).toBe(true);
	});

	test("does not descend into a discovered project's subdirectories", async () => {
		// A skilltree project should not be probed further — if `a/` is a
		// project, nested `a/sub/` should be ignored even if it has its own manifest.
		// This matches `find -name skilltree.yml -prune`-style scanning and keeps
		// the walk fast on monorepos.
		await writeManifest(join(tempDir, "a"), "name: a\n");
		await writeManifest(join(tempDir, "a", "sub"), "name: nested\n");

		await projectsCommand({ root: tempDir, json: true });

		const out = JSON.parse(logs[0] ?? "[]") as Array<{ path: string }>;
		expect(out).toHaveLength(1);
		expect(out[0]?.path).toBe(join(tempDir, "a"));
	});
});
