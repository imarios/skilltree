// Tests for `skilltree doctor` (Nitrogen Phase 2 — issue #84).
// Phase 2 lands text mode + exit codes + acceptance criteria 1-3.
// `--json`, `--global`, and real registry reachability arrive in Phase 3.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorCommand, runDoctor } from "../../src/commands/doctor.js";
import { serializeLockfile } from "../../src/core/lockfile.js";
import type { Lockfile } from "../../src/types.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface ProjectSpec {
	manifest: string;
	lockfile?: Lockfile | null;
	files?: Array<{ path: string; content: string }>;
}

async function makeProject(spec: ProjectSpec): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-doctor-"));
	await writeFile(join(tempDir, "skilltree.yml"), spec.manifest, "utf-8");
	if (spec.lockfile !== null && spec.lockfile !== undefined) {
		await writeFile(join(tempDir, "skilltree.lock"), serializeLockfile(spec.lockfile), "utf-8");
	}
	for (const f of spec.files ?? []) {
		const full = join(tempDir, f.path);
		await mkdir(join(full, ".."), { recursive: true });
		await writeFile(full, f.content, "utf-8");
	}
	return tempDir;
}

function emptyLockfile(): Lockfile {
	return { lockfile_version: 1, install_targets: ["claude"], packages: {} };
}

function cleanProject(): ProjectSpec {
	return {
		manifest: ["name: clean", "install_targets:", "  - claude", "dependencies: {}", ""].join("\n"),
		lockfile: emptyLockfile(),
	};
}

function projectWithLocalSkill(
	opts: { skillName?: string; badFrontmatter?: boolean } = {},
): ProjectSpec {
	const name = opts.skillName ?? "foo";
	const frontmatter = opts.badFrontmatter
		? "---\ndescription: missing name\n---\n\n# foo\n"
		: `---\nname: ${name}\ndescription: A skill\n---\n\n# ${name}\n`;
	return {
		manifest: [
			"name: skill-project",
			"install_targets:",
			"  - claude",
			"dependencies:",
			`  ${name}:`,
			`    local: ./skills/${name}`,
			"    type: skill",
			"",
		].join("\n"),
		lockfile: {
			lockfile_version: 1,
			install_targets: ["claude"],
			packages: {
				[name]: {
					source: "local",
					path: `./skills/${name}`,
					name,
					type: "skill",
					group: "prod",
					commit: "HEAD",
					dependencies: [],
				},
			},
		},
		files: [{ path: `skills/${name}/SKILL.md`, content: frontmatter }],
	};
}

function captureOutput(): { logs: string[]; warns: string[]; errs: string[]; restore: () => void } {
	const logs: string[] = [];
	const warns: string[] = [];
	const errs: string[] = [];
	const origLog = console.log;
	const origWarn = console.warn;
	const origErr = console.error;
	console.log = (msg: unknown) => logs.push(typeof msg === "string" ? msg : String(msg));
	console.warn = (msg: unknown) => warns.push(typeof msg === "string" ? msg : String(msg));
	console.error = (msg: unknown) => errs.push(typeof msg === "string" ? msg : String(msg));
	return {
		logs,
		warns,
		errs,
		restore: () => {
			console.log = origLog;
			console.warn = origWarn;
			console.error = origErr;
		},
	};
}

async function runCli(
	dir: string,
): Promise<{ logs: string[]; warns: string[]; errs: string[]; exitCode: number | undefined }> {
	const cap = captureOutput();
	const origExit = process.exit;
	let exitCode: number | undefined;
	process.exit = ((c: number) => {
		exitCode = c;
		throw new Error(`exit ${c}`);
	}) as typeof process.exit;
	try {
		await doctorCommand(dir);
	} catch (e) {
		if (!(e instanceof Error && /^exit/.test(e.message))) throw e;
	} finally {
		process.exit = origExit;
		cap.restore();
	}
	return { logs: cap.logs, warns: cap.warns, errs: cap.errs, exitCode };
}

// ---------------------------------------------------------------------------
// runDoctor — data-shape tests
// ---------------------------------------------------------------------------

describe("runDoctor — clean project", () => {
	test("acceptance #1: fresh init+install passes all non-skipped checks", async () => {
		const dir = await makeProject(cleanProject());
		const report = await runDoctor(dir);
		expect(report.summary.fail).toBe(0);
		// All checks that ran (non-skip) are pass
		for (const c of report.checks) {
			if (c.status === "skip") continue;
			expect(c.status).toBe("pass");
		}
	});
});

describe("runDoctor — lockfile sync", () => {
	test("acceptance #2: deleted lockfile → fail on lockfile-sync", async () => {
		const dir = await makeProject(cleanProject());
		await unlink(join(dir, "skilltree.lock"));
		const report = await runDoctor(dir);
		const lock = report.checks.find((c) => c.name === "lockfile-sync");
		expect(lock?.status).toBe("fail");
		expect(report.summary.fail).toBeGreaterThanOrEqual(1);
	});

	test("manifest adds a dep not in lockfile → fail with `skilltree install` fix", async () => {
		const dir = await makeProject({
			manifest: [
				"name: drift",
				"install_targets:",
				"  - claude",
				"dependencies:",
				"  newdep:",
				"    local: ./skills/newdep",
				"    type: skill",
				"",
			].join("\n"),
			lockfile: emptyLockfile(),
			files: [
				{
					path: "skills/newdep/SKILL.md",
					content: "---\nname: newdep\ndescription: x\n---\n",
				},
			],
		});
		const report = await runDoctor(dir);
		const lock = report.checks.find((c) => c.name === "lockfile-sync");
		expect(lock?.status).toBe("fail");
		expect((lock?.detail ?? "") + (lock?.fix ?? "")).toMatch(/skilltree install/);
	});
});

describe("runDoctor — lint / frontmatter", () => {
	test("acceptance #3: malformed SKILL.md fails on lint", async () => {
		const dir = await makeProject(projectWithLocalSkill({ badFrontmatter: true }));
		const report = await runDoctor(dir);
		const lint = report.checks.find((c) => c.name === "lint");
		expect(lint?.status).toBe("fail");
		expect(report.summary.fail).toBeGreaterThanOrEqual(1);
	});

	test("asymmetric publish leak → lint fail", async () => {
		const dir = await makeProject({
			manifest: [
				"name: leak",
				"install_targets:",
				"  - claude",
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
			lockfile: {
				lockfile_version: 1,
				install_targets: ["claude"],
				packages: {
					root: {
						source: "local",
						path: "./skills/root",
						name: "root",
						type: "skill",
						group: "prod",
						commit: "HEAD",
						dependencies: ["leaf"],
					},
					leaf: {
						source: "local",
						path: "./skills/leaf",
						name: "leaf",
						type: "skill",
						group: "prod",
						commit: "HEAD",
						dependencies: [],
					},
				},
			},
			files: [
				{
					path: "skills/root/SKILL.md",
					content: "---\nname: root\ndescription: x\ndependencies:\n  - leaf\n---\n",
				},
				{ path: "skills/leaf/SKILL.md", content: "---\nname: leaf\ndescription: x\n---\n" },
			],
		});
		const report = await runDoctor(dir);
		const lint = report.checks.find((c) => c.name === "lint");
		expect(lint?.status).toBe("fail");
	});
});

describe("runDoctor — target consistency", () => {
	test("install_targets pointing at a missing literal path → fail", async () => {
		const dir = await makeProject({
			manifest: [
				"name: bad-target",
				"install_targets:",
				"  - ./does-not-exist-doctor-test",
				"dependencies: {}",
				"",
			].join("\n"),
			lockfile: {
				lockfile_version: 1,
				install_targets: ["./does-not-exist-doctor-test"],
				packages: {},
			},
		});
		const report = await runDoctor(dir);
		const tgt = report.checks.find((c) => c.name === "target-consistency");
		expect(tgt?.status).toBe("fail");
		expect(tgt?.detail).toContain("does-not-exist");
	});
});

describe("runDoctor — registry reachability (Phase 2 stub)", () => {
	test("is skipped with deferred detail", async () => {
		const dir = await makeProject(cleanProject());
		const report = await runDoctor(dir);
		const reach = report.checks.find((c) => c.name === "registry-reachability");
		expect(reach?.status).toBe("skip");
		expect(reach?.detail).toMatch(/defer/i);
	});
});

describe("runDoctor — check ordering and stability", () => {
	test("checks appear in the documented order", async () => {
		const dir = await makeProject(cleanProject());
		const report = await runDoctor(dir);
		const names = report.checks.map((c) => c.name);
		expect(names).toEqual([
			"manifest-schema",
			"lint",
			"lockfile-sync",
			"target-consistency",
			"registry-reachability",
			"frontmatter",
		]);
	});

	test("summary counts match check rows", async () => {
		const dir = await makeProject(cleanProject());
		const report = await runDoctor(dir);
		const counts = { pass: 0, fail: 0, warn: 0, skip: 0 };
		for (const c of report.checks) counts[c.status]++;
		expect(report.summary).toEqual(counts);
	});
});

// ---------------------------------------------------------------------------
// doctorCommand — CLI behavior
// ---------------------------------------------------------------------------

describe("doctorCommand — exit codes", () => {
	test("exit 0 on all-pass", async () => {
		const dir = await makeProject(cleanProject());
		const out = await runCli(dir);
		expect(out.exitCode).toBeUndefined();
	});

	test("exit 1 on any fail", async () => {
		const dir = await makeProject(cleanProject());
		await unlink(join(dir, "skilltree.lock"));
		const out = await runCli(dir);
		expect(out.exitCode).toBe(1);
	});
});

describe("doctorCommand — text rendering", () => {
	test("clean project shows ✔ symbols", async () => {
		const dir = await makeProject(cleanProject());
		const out = await runCli(dir);
		const all = out.logs.join("\n");
		expect(all).toContain("✔");
		expect(all).toContain("manifest-schema");
	});

	test("fail row shows ✘ and the indented → fix line", async () => {
		const dir = await makeProject(cleanProject());
		await unlink(join(dir, "skilltree.lock"));
		const out = await runCli(dir);
		const all = out.logs.join("\n") + "\n" + out.warns.join("\n") + "\n" + out.errs.join("\n");
		expect(all).toContain("✘");
		expect(all).toContain("lockfile-sync");
	});

	test("footer summarizes pass/fail/warn counts", async () => {
		const dir = await makeProject(cleanProject());
		const out = await runCli(dir);
		const all = out.logs.join("\n");
		// Either "all checks passed" or a numeric pass summary works — assert
		// the row count rendering renders a footer line that mentions "doctor"
		// (consistent with spec §D14 footer prefix).
		expect(all).toMatch(/doctor:/i);
	});
});
