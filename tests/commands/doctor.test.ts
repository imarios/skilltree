// Tests for `skilltree doctor` (Nitrogen Phases 2 & 3 — issue #84).
// Phase 2 landed text mode + exit codes + acceptance criteria 1-3.
// Phase 3 adds --json, --global, real registry reachability, and the
// read-only invariant test.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
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
	extraOpts: Parameters<typeof doctorCommand>[1] = {},
): Promise<{ logs: string[]; warns: string[]; errs: string[]; exitCode: number | undefined }> {
	const cap = captureOutput();
	const origExit = process.exit;
	let exitCode: number | undefined;
	process.exit = ((c: number) => {
		exitCode = c;
		throw new Error(`exit ${c}`);
	}) as typeof process.exit;
	// Default to network-isolated execution so the suite doesn't depend on
	// the developer's ~/.skilltree/config.yaml.
	const cfg = extraOpts.registryConfigPath ?? (await writeRegistriesFile([]));
	const isolated = { probe: okProbe, registryConfigPath: cfg, ...extraOpts };
	try {
		await doctorCommand(dir, isolated);
	} catch (e) {
		if (!(e instanceof Error && /^exit/.test(e.message))) throw e;
	} finally {
		process.exit = origExit;
		cap.restore();
	}
	return { logs: cap.logs, warns: cap.warns, errs: cap.errs, exitCode };
}

// ---------------------------------------------------------------------------
// Network isolation: every test runs against an empty registry config + a
// no-op reachability probe so we never make real `git ls-remote` calls.
// Tests that need to assert on reachability behavior override these via
// `runDoctor(dir, { probe: <mock>, registryConfigPath: <fixture> })`.
// ---------------------------------------------------------------------------

const okProbe = async () => ({ ok: true as const });

// Helper: write a registries file and return its absolute path.
// Forward-declared so the no-network defaults below can use it.
async function writeRegistriesFile(
	registries: Array<{ name: string; repo: string }>,
): Promise<string> {
	if (!tempDir) tempDir = await mkdtemp(join(tmpdir(), "skilltree-doctor-cfg-"));
	const cfgPath = join(
		tempDir,
		`config-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.yaml`,
	);
	const body = `registries:\n${registries.map((r) => `  - name: ${r.name}\n    repo: ${r.repo}`).join("\n")}\n`;
	await writeFile(cfgPath, body, "utf-8");
	return cfgPath;
}

/**
 * Wrapper around `runDoctor` that defaults to network-free execution.
 * Tests that explicitly want to test reachability override `probe` and/or
 * `registryConfigPath`. This isolates the suite from the developer's
 * actual `~/.skilltree/config.yaml`.
 */
async function runDoctorIsolated(dir: string, opts: Parameters<typeof runDoctor>[1] = {}) {
	const cfg = opts.registryConfigPath ?? (await writeRegistriesFile([]));
	return runDoctor(dir, { probe: okProbe, registryConfigPath: cfg, ...opts });
}

// ---------------------------------------------------------------------------
// runDoctor — data-shape tests
// ---------------------------------------------------------------------------

describe("runDoctor — clean project", () => {
	test("acceptance #1: fresh init+install passes all non-skipped checks", async () => {
		const dir = await makeProject(cleanProject());
		const report = await runDoctorIsolated(dir);
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
		// Use a project with at least one declared dep so the missing lockfile
		// is a real sync mismatch — empty-deps projects pass vacuously now
		// (issue #121).
		const dir = await makeProject(projectWithLocalSkill());
		await unlink(join(dir, "skilltree.lock"));
		const report = await runDoctorIsolated(dir);
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
		const report = await runDoctorIsolated(dir);
		const lock = report.checks.find((c) => c.name === "lockfile-sync");
		expect(lock?.status).toBe("fail");
		expect((lock?.detail ?? "") + (lock?.fix ?? "")).toMatch(/skilltree install/);
	});
});

describe("runDoctor — lint / frontmatter", () => {
	test("acceptance #3: malformed SKILL.md fails on lint", async () => {
		const dir = await makeProject(projectWithLocalSkill({ badFrontmatter: true }));
		const report = await runDoctorIsolated(dir);
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
		const report = await runDoctorIsolated(dir);
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
		const report = await runDoctorIsolated(dir);
		const tgt = report.checks.find((c) => c.name === "target-consistency");
		expect(tgt?.status).toBe("fail");
		expect(tgt?.detail).toContain("does-not-exist");
	});
});

describe("runDoctor — registry reachability (Phase 3, default)", () => {
	test("with no registries configured → pass", async () => {
		const dir = await makeProject(cleanProject());
		// Point at an empty config so no real `git ls-remote` is attempted.
		const cfg = await writeRegistriesFile([]);
		const report = await runDoctor(dir, { registryConfigPath: cfg });
		const reach = report.checks.find((c) => c.name === "registry-reachability");
		expect(reach?.status).toBe("pass");
		expect(reach?.detail).toMatch(/no registries/i);
	});
});

describe("runDoctor — check ordering and stability", () => {
	test("checks appear in the documented order", async () => {
		const dir = await makeProject(cleanProject());
		const report = await runDoctorIsolated(dir);
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
		const report = await runDoctorIsolated(dir);
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
		const dir = await makeProject(projectWithLocalSkill());
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
		const dir = await makeProject(projectWithLocalSkill());
		await unlink(join(dir, "skilltree.lock"));
		const out = await runCli(dir);
		const all = `${out.logs.join("\n")}\n${out.warns.join("\n")}\n${out.errs.join("\n")}`;
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

// ===========================================================================
// PHASE 3 — `--json`, `--global`, reachability, read-only invariant
// ===========================================================================

// `okProbe`, `writeRegistriesFile`, and `runDoctorIsolated` are declared
// at the top of the file (network isolation block).

// ---------------------------------------------------------------------------
// --json output shape
// ---------------------------------------------------------------------------

describe("runDoctor — --json output", () => {
	test("J1: JSON shape stable across clean run", async () => {
		const dir = await makeProject(cleanProject());
		const report = await runDoctorIsolated(dir);
		// Normalize the report to only structural fields (status counts, names)
		// so we don't bake in detail strings that may evolve.
		const skeleton = {
			names: report.checks.map((c) => c.name),
			statuses: report.checks.map((c) => c.status),
			summaryKeys: Object.keys(report.summary).sort(),
		};
		expect(skeleton).toMatchSnapshot();
	});

	test("J2: detail and fix omitted on pass rows", async () => {
		const dir = await makeProject(cleanProject());
		const report = await runDoctorIsolated(dir);
		const passRow = report.checks.find((c) => c.status === "pass");
		expect(passRow).toBeDefined();
		expect(passRow?.detail).toBeUndefined();
		expect(passRow?.fix).toBeUndefined();
	});

	test("J3: fail row includes detail and fix when applicable", async () => {
		const dir = await makeProject(projectWithLocalSkill());
		await unlink(join(dir, "skilltree.lock"));
		const report = await runDoctorIsolated(dir);
		const lock = report.checks.find((c) => c.name === "lockfile-sync");
		expect(lock?.status).toBe("fail");
		expect(lock?.detail).toBeTruthy();
		expect(lock?.fix).toBeTruthy();
	});

	test("J4: name identifiers match the documented kebab-case list", async () => {
		const dir = await makeProject(cleanProject());
		const report = await runDoctorIsolated(dir);
		expect(report.checks.map((c) => c.name)).toEqual([
			"manifest-schema",
			"lint",
			"lockfile-sync",
			"target-consistency",
			"registry-reachability",
			"frontmatter",
		]);
	});

	test("J5: summary tally equals checks count", async () => {
		const dir = await makeProject(cleanProject());
		const report = await runDoctorIsolated(dir);
		const tally =
			report.summary.pass + report.summary.warn + report.summary.fail + report.summary.skip;
		expect(tally).toBe(report.checks.length);
	});
});

// ---------------------------------------------------------------------------
// --global mode
// ---------------------------------------------------------------------------

async function makeGlobalProject(opts: { manifest: string }): Promise<{ globalDir: string }> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-doctor-global-"));
	const skilltreeDir = join(tempDir, ".skilltree");
	await mkdir(skilltreeDir, { recursive: true });
	await writeFile(join(skilltreeDir, "global.yml"), opts.manifest, "utf-8");
	return { globalDir: skilltreeDir };
}

describe("runDoctor — --global mode", () => {
	test("G1: project-scoped checks (lockfile, targets) are skipped", async () => {
		const { globalDir } = await makeGlobalProject({
			manifest: "name: global\ndependencies: {}\n",
		});
		const report = await runDoctor("/no-such-project-dir", {
			global: true,
			globalDir,
			probe: okProbe,
			registryConfigPath: await writeRegistriesFile([]),
		});
		const lock = report.checks.find((c) => c.name === "lockfile-sync");
		const tgt = report.checks.find((c) => c.name === "target-consistency");
		expect(lock?.status).toBe("skip");
		expect(lock?.detail).toMatch(/global/i);
		expect(tgt?.status).toBe("skip");
	});

	test("G2: lint and frontmatter still run", async () => {
		const { globalDir } = await makeGlobalProject({
			manifest: "name: global\ndependencies: {}\n",
		});
		const report = await runDoctor("/no-such-project-dir", {
			global: true,
			globalDir,
			probe: okProbe,
			registryConfigPath: await writeRegistriesFile([]),
		});
		const lint = report.checks.find((c) => c.name === "lint");
		const fm = report.checks.find((c) => c.name === "frontmatter");
		// Both should be pass (clean global, no local entries) — they must
		// at minimum not be `fail` for a clean manifest.
		expect(lint?.status).not.toBe("fail");
		expect(fm?.status).not.toBe("fail");
	});

	test("G3: registry-reachability still runs in global mode", async () => {
		const { globalDir } = await makeGlobalProject({
			manifest: "name: global\ndependencies: {}\n",
		});
		let probeCalled = false;
		const watchedProbe = async (_url: string) => {
			probeCalled = true;
			return { ok: true as const };
		};
		await runDoctor("/no-such-project-dir", {
			global: true,
			globalDir,
			probe: watchedProbe,
			// Force a registry to exist so the probe is called at all.
			registryConfigPath: await writeRegistriesFile([
				{ name: "test", repo: "github.com/example/repo" },
			]),
		});
		expect(probeCalled).toBe(true);
	});

	test("G4: missing global manifest → manifest-schema fail", async () => {
		const noManifest = await mkdtemp(join(tmpdir(), "skilltree-doctor-noglobal-"));
		tempDir = noManifest;
		const report = await runDoctor("/no-such-project-dir", {
			global: true,
			globalDir: noManifest, // exists but has no global.yaml
			probe: okProbe,
		});
		const sch = report.checks.find((c) => c.name === "manifest-schema");
		expect(sch?.status).toBe("fail");
	});
});

// `writeRegistriesFile` is declared at the top of the file.

// ---------------------------------------------------------------------------
// Registry reachability check
// ---------------------------------------------------------------------------

describe("runDoctor — registry reachability", () => {
	test("R1: all reachable → pass", async () => {
		const dir = await makeProject(cleanProject());
		const cfg = await writeRegistriesFile([
			{ name: "a", repo: "github.com/example/a" },
			{ name: "b", repo: "github.com/example/b" },
		]);
		const report = await runDoctor(dir, {
			probe: async () => ({ ok: true as const }),
			registryConfigPath: cfg,
		});
		const r = report.checks.find((c) => c.name === "registry-reachability");
		expect(r?.status).toBe("pass");
	});

	test("R2: one unreachable → warn", async () => {
		const dir = await makeProject(cleanProject());
		const cfg = await writeRegistriesFile([
			{ name: "good", repo: "github.com/example/a" },
			{ name: "bad", repo: "github.com/example/b" },
		]);
		const report = await runDoctor(dir, {
			probe: async (url) =>
				url.includes("/b")
					? { ok: false as const, reason: "unreachable" as const, detail: "could not connect" }
					: { ok: true as const },
			registryConfigPath: cfg,
		});
		const r = report.checks.find((c) => c.name === "registry-reachability");
		expect(r?.status).toBe("warn");
		expect(r?.detail ?? "").toMatch(/bad|unreachable/);
	});

	test("R3: auth-required is warn, not fail", async () => {
		const dir = await makeProject(cleanProject());
		const cfg = await writeRegistriesFile([
			{ name: "private", repo: "github.com/example/private" },
		]);
		const report = await runDoctor(dir, {
			probe: async () => ({
				ok: false as const,
				reason: "auth" as const,
				detail: "Authentication failed",
			}),
			registryConfigPath: cfg,
		});
		const r = report.checks.find((c) => c.name === "registry-reachability");
		expect(r?.status).toBe("warn");
		expect(r?.detail ?? "").toMatch(/auth/i);
	});

	test("R4: timeout is warn, not fail", async () => {
		const dir = await makeProject(cleanProject());
		const cfg = await writeRegistriesFile([{ name: "slow", repo: "github.com/example/slow" }]);
		const report = await runDoctor(dir, {
			probe: async () => ({
				ok: false as const,
				reason: "timeout" as const,
				detail: "timed out after 5000ms",
			}),
			registryConfigPath: cfg,
		});
		const r = report.checks.find((c) => c.name === "registry-reachability");
		expect(r?.status).toBe("warn");
		expect(r?.detail ?? "").toMatch(/timeout|timed out/i);
	});

	test("R5: empty registry list → pass with 'no registries configured'", async () => {
		const dir = await makeProject(cleanProject());
		const cfg = await writeRegistriesFile([]);
		const report = await runDoctor(dir, {
			probe: async () => ({ ok: true as const }),
			registryConfigPath: cfg,
		});
		const r = report.checks.find((c) => c.name === "registry-reachability");
		expect(r?.status).toBe("pass");
		expect(r?.detail ?? "").toMatch(/no registries/i);
	});

	test("R6: probe throws → reachability is fail (per-check error isolation)", async () => {
		const dir = await makeProject(cleanProject());
		const cfg = await writeRegistriesFile([{ name: "x", repo: "github.com/example/x" }]);
		const report = await runDoctor(dir, {
			probe: async () => {
				throw new Error("probe blew up");
			},
			registryConfigPath: cfg,
		});
		const r = report.checks.find((c) => c.name === "registry-reachability");
		expect(r?.status).toBe("fail");
		expect(r?.detail ?? "").toMatch(/blew up/);
	});
});

// ---------------------------------------------------------------------------
// CLI behavior — json + exit codes
// ---------------------------------------------------------------------------

async function runCliWithOpts(
	dir: string,
	opts: Parameters<typeof doctorCommand>[1] = {},
): Promise<{ logs: string[]; errs: string[]; exitCode: number | undefined }> {
	const cap = captureOutput();
	const origExit = process.exit;
	let exitCode: number | undefined;
	process.exit = ((c: number) => {
		exitCode = c;
		throw new Error(`exit ${c}`);
	}) as typeof process.exit;
	const cfg = opts.registryConfigPath ?? (await writeRegistriesFile([]));
	const isolated = { probe: okProbe, registryConfigPath: cfg, ...opts };
	try {
		await doctorCommand(dir, isolated);
	} catch (e) {
		if (!(e instanceof Error && /^exit/.test(e.message))) throw e;
	} finally {
		process.exit = origExit;
		cap.restore();
	}
	return { logs: cap.logs, errs: cap.errs, exitCode };
}

describe("doctorCommand — --json", () => {
	test("C1: exit 0 on pass; stdout is valid JSON", async () => {
		const dir = await makeProject(cleanProject());
		const out = await runCliWithOpts(dir, { json: true, probe: okProbe });
		expect(out.exitCode).toBeUndefined();
		const parsed = JSON.parse(out.logs.join("\n"));
		expect(Array.isArray(parsed.checks)).toBe(true);
		expect(parsed.summary).toBeDefined();
	});

	test("C2: exit 1 on fail; stdout is valid JSON", async () => {
		const dir = await makeProject(projectWithLocalSkill());
		await unlink(join(dir, "skilltree.lock"));
		const out = await runCliWithOpts(dir, { json: true, probe: okProbe });
		expect(out.exitCode).toBe(1);
		const parsed = JSON.parse(out.logs.join("\n"));
		expect(parsed.summary.fail).toBeGreaterThanOrEqual(1);
	});

	test("C3: JSON output has no ANSI color codes", async () => {
		const dir = await makeProject(cleanProject());
		const out = await runCliWithOpts(dir, { json: true, probe: okProbe });
		const body = out.logs.join("\n");
		// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences
		expect(body).not.toMatch(/\x1b\[/);
	});
});

// ---------------------------------------------------------------------------
// Read-only invariant
// ---------------------------------------------------------------------------

async function snapshotMtimes(dir: string): Promise<Map<string, number>> {
	const out = new Map<string, number>();
	async function walk(d: string) {
		const entries = await readdir(d, { withFileTypes: true });
		for (const ent of entries) {
			const p = join(d, ent.name);
			if (ent.isDirectory()) {
				await walk(p);
			} else if (ent.isFile()) {
				const s = await stat(p);
				out.set(p, s.mtimeMs);
			}
		}
	}
	await walk(dir);
	return out;
}

describe("runDoctor — read-only invariant", () => {
	test("RO1: text mode does not change any file mtime", async () => {
		const dir = await makeProject(cleanProject());
		// Pre-create the registry config so it's part of the baseline snapshot;
		// otherwise `runDoctorIsolated` would create it after the snapshot and
		// the post-run comparison would (correctly) see a "new" file.
		const cfg = await writeRegistriesFile([]);
		const before = await snapshotMtimes(dir);
		await runDoctor(dir, { probe: okProbe, registryConfigPath: cfg });
		const after = await snapshotMtimes(dir);
		expect(after.size).toBe(before.size);
		for (const [path, mt] of before.entries()) {
			expect(after.get(path)).toBe(mt);
		}
	});

	test("RO2: json mode does not change any file mtime", async () => {
		const dir = await makeProject(cleanProject());
		const cfg = await writeRegistriesFile([]);
		const before = await snapshotMtimes(dir);
		const cap = captureOutput();
		try {
			await doctorCommand(dir, { json: true, probe: okProbe, registryConfigPath: cfg });
		} finally {
			cap.restore();
		}
		const after = await snapshotMtimes(dir);
		for (const [path, mt] of before.entries()) {
			expect(after.get(path)).toBe(mt);
		}
	});

	test("RO3: global mode does not change any file mtime under globalDir (#115)", async () => {
		// Belt-and-braces: the global codepath shares the same per-check
		// functions as project mode but routes through `loadManifestOrThrow
		// ({ global: true })` and short-circuits project-only checks. RO1/RO2
		// don't cover global-specific paths, so a regression that mutated
		// `~/.skilltree/` would slip past.
		const { globalDir } = await makeGlobalProject({
			manifest: "name: global\ndependencies: {}\n",
		});
		const cfg = await writeRegistriesFile([]);
		const before = await snapshotMtimes(globalDir);
		await runDoctor("/no-such-project-dir", {
			global: true,
			globalDir,
			probe: okProbe,
			registryConfigPath: cfg,
		});
		const after = await snapshotMtimes(globalDir);
		expect(after.size).toBe(before.size);
		for (const [path, mt] of before.entries()) {
			expect(after.get(path)).toBe(mt);
		}
	});
});

// ---------------------------------------------------------------------------
// Empty-deps vacuous pass for lockfile-sync (#121)
// ---------------------------------------------------------------------------

describe("runDoctor — empty-deps vacuous pass (#121)", () => {
	test("fresh init (zero deps, no lockfile) passes lockfile-sync, exits 0", async () => {
		const dir = await makeProject({
			manifest: ["name: fresh", "install_targets:", "  - claude", "dependencies: {}", ""].join(
				"\n",
			),
			lockfile: null,
		});
		const report = await runDoctorIsolated(dir);
		const lock = report.checks.find((c) => c.name === "lockfile-sync");
		expect(lock?.status).toBe("pass");
		expect(lock?.detail ?? "").toMatch(/no (deps|dependencies)/i);
		expect(report.summary.fail).toBe(0);
	});

	test("zero deps in both groups still passes vacuously", async () => {
		const dir = await makeProject({
			manifest: [
				"name: fresh",
				"install_targets:",
				"  - claude",
				"dependencies: {}",
				"dev-dependencies: {}",
				"",
			].join("\n"),
			lockfile: null,
		});
		const report = await runDoctorIsolated(dir);
		expect(report.checks.find((c) => c.name === "lockfile-sync")?.status).toBe("pass");
	});
});

// ---------------------------------------------------------------------------
// Manifest / lockfile error attribution (#123)
// ---------------------------------------------------------------------------

describe("runDoctor — manifest / lockfile error attribution (#123)", () => {
	test("malformed YAML in skilltree.yml → manifest-schema fails with a parse-error message, not 'No skilltree.yml found'", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-doctor-malformed-"));
		await writeFile(join(tempDir, "skilltree.yml"), "name: [unclosed\n", "utf-8");
		const cfg = await writeRegistriesFile([]);
		const report = await runDoctor(tempDir, { probe: okProbe, registryConfigPath: cfg });
		const schema = report.checks.find((c) => c.name === "manifest-schema");
		expect(schema?.status).toBe("fail");
		// The new wording references the file by name and reflects a parse error
		// rather than the misleading "No skilltree.yml found".
		expect(schema?.detail ?? "").toMatch(/skilltree\.yml/);
		expect(schema?.detail ?? "").not.toMatch(/No skilltree\.yml found/);
	});

	test("lockfile missing `lockfile_version` key → lockfile-sync names the missing field, not `undefined`", async () => {
		const dir = await makeProject(projectWithLocalSkill());
		// Overwrite the lockfile with a body that lacks `lockfile_version`.
		await writeFile(
			join(dir, "skilltree.lock"),
			"# skilltree.lock -- DO NOT EDIT MANUALLY\nversion: 1\npackages: {}\n",
			"utf-8",
		);
		const report = await runDoctorIsolated(dir);
		const lock = report.checks.find((c) => c.name === "lockfile-sync");
		expect(lock?.status).toBe("fail");
		expect(lock?.detail ?? "").toMatch(/lockfile_version/);
		expect(lock?.detail ?? "").not.toMatch(/undefined/);
	});
});
