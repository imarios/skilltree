import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCommand, lintAsymmetricPublish } from "../../src/commands/check.js";
import type { ResolvedEntity } from "../../src/core/graph.js";
import { createLocalSkill } from "../helpers/git-fixtures.js";

function entity(
	name: string,
	deps: string[] = [],
	opts: { publish?: boolean; group?: "prod" | "dev"; local?: boolean } = {},
): ResolvedEntity {
	const e: ResolvedEntity = {
		key: name,
		name,
		type: "skill",
		group: opts.group ?? "prod",
		path: `./skills/${name}`,
		commit: "HEAD",
		local: opts.local ?? true,
		dependencies: deps,
	};
	if (opts.publish !== undefined) e.publish = opts.publish;
	return e;
}

function buildMap(...entities: ResolvedEntity[]): Map<string, ResolvedEntity> {
	const m = new Map<string, ResolvedEntity>();
	for (const e of entities) m.set(`${e.type}:${e.name}`, e);
	return m;
}

describe("lintAsymmetricPublish (Carbon Phase 5)", () => {
	test("flags direct asymmetric chain (root → publish:false)", () => {
		const entities = buildMap(
			entity("analysis", ["experimental"]),
			entity("experimental", [], { publish: false }),
		);
		const warnings = lintAsymmetricPublish(entities);
		expect(warnings.length).toBe(1);
		expect(warnings[0]).toContain("analysis");
		expect(warnings[0]).toContain("experimental");
		expect(warnings[0]).toContain("publish: false");
	});

	test("flags transitive (2-hop) asymmetric chain — one warning per leaking published root", () => {
		const entities = buildMap(
			entity("analysis", ["loader"]),
			entity("loader", ["experimental"]),
			entity("experimental", [], { publish: false }),
		);
		const warnings = lintAsymmetricPublish(entities);
		// Both `analysis` and `loader` are publicly published AND reach
		// `experimental` (publish:false). Both leak, so both are flagged —
		// fixing `experimental` resolves both warnings.
		expect(warnings.length).toBe(2);
		const joined = warnings.join("\n---\n");
		expect(joined).toContain("analysis");
		expect(joined).toContain("loader");
		expect(joined).toContain("experimental");
	});

	test("flags multiple chains from one root", () => {
		const entities = buildMap(
			entity("analysis", ["wip-a", "wip-b"]),
			entity("wip-a", [], { publish: false }),
			entity("wip-b", [], { publish: false }),
		);
		const warnings = lintAsymmetricPublish(entities);
		expect(warnings.length).toBe(2);
	});

	test("clean manifest — all published — no warnings", () => {
		const entities = buildMap(entity("analysis", ["loader"]), entity("loader", []));
		expect(lintAsymmetricPublish(entities)).toEqual([]);
	});

	test("all entities publish:false — no warnings (no exposed roots)", () => {
		const entities = buildMap(
			entity("a", ["b"], { publish: false }),
			entity("b", [], { publish: false }),
		);
		expect(lintAsymmetricPublish(entities)).toEqual([]);
	});

	test("ignores remote (non-local) deps", () => {
		// 'remote-thing' isn't in the same repo; we don't traverse beyond it.
		const entities = buildMap(
			entity("analysis", ["remote-thing"]),
			// remote-thing intentionally missing from entities — represents a remote dep
		);
		expect(lintAsymmetricPublish(entities)).toEqual([]);
	});

	test("ignores publish:true → remote (still no warning even if remote is dev/private)", () => {
		const remote: ResolvedEntity = {
			key: "remote-tool",
			name: "remote-tool",
			type: "skill",
			group: "prod",
			path: "skills/remote-tool",
			commit: "abc123",
			local: false,
			dependencies: [],
		};
		const entities = buildMap(entity("analysis", ["remote-tool"]), remote);
		expect(lintAsymmetricPublish(entities)).toEqual([]);
	});

	test("skips dev-group roots (they're not consumer-facing in the first place)", () => {
		const entities = buildMap(
			entity("dev-tool", ["wip"], { group: "dev" }),
			entity("wip", [], { publish: false }),
		);
		expect(lintAsymmetricPublish(entities)).toEqual([]);
	});

	test("renders chain in arrow format with the leak marked", () => {
		const entities = buildMap(
			entity("a", ["b"]),
			entity("b", ["c"]),
			entity("c", [], { publish: false }),
		);
		const [warning] = lintAsymmetricPublish(entities);
		expect(warning).toContain("a (published)");
		expect(warning).toContain("→ b (published)");
		expect(warning).toContain("→ c (publish: false)");
		expect(warning).toContain("blocks downstream consumers");
		expect(warning).toContain("Fix:");
	});

	test("handles cycles among published nodes without infinite loop", () => {
		// a → b → a (cycle). No publish:false anywhere → no warnings, no hang.
		const entities = buildMap(entity("a", ["b"]), entity("b", ["a"]));
		expect(lintAsymmetricPublish(entities)).toEqual([]);
	});
});

// --- checkCommand (end-to-end) ---

let tempDir: string;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function makeProject(
	manifest: string,
	skills: Array<{ name: string; deps?: string[] }>,
): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "skilltree-check-cmd-"));
	await writeFile(join(tempDir, "skilltree.yml"), manifest, "utf-8");
	for (const s of skills) {
		await createLocalSkill(join(tempDir, "skills"), s.name, s.deps);
	}
	return tempDir;
}

function captureOutput(): { logs: string[]; warns: string[]; restore: () => void } {
	const logs: string[] = [];
	const warns: string[] = [];
	const origLog = console.log;
	const origWarn = console.warn;
	console.log = (msg: string) => {
		logs.push(typeof msg === "string" ? msg : String(msg));
	};
	console.warn = (msg: string) => {
		warns.push(typeof msg === "string" ? msg : String(msg));
	};
	return {
		logs,
		warns,
		restore: () => {
			console.log = origLog;
			console.warn = origWarn;
		},
	};
}

describe("checkCommand (end-to-end)", () => {
	test("clean manifest prints success and exits 0", async () => {
		const dir = await makeProject(
			[
				"name: test",
				"dependencies:",
				"  foo:",
				"    local: ./skills/foo",
				"    type: skill",
				"",
			].join("\n"),
			[{ name: "foo" }],
		);

		const cap = captureOutput();
		try {
			await checkCommand(dir);
		} finally {
			cap.restore();
		}
		expect(cap.warns).toEqual([]);
		expect(cap.logs.join("\n")).toContain("No issues");
	});

	test("manifest with leak emits warnings (non-strict, exit 0)", async () => {
		const dir = await makeProject(
			[
				"name: test",
				"dependencies:",
				"  analysis:",
				"    local: ./skills/analysis",
				"    type: skill",
				"  experimental:",
				"    local: ./skills/experimental",
				"    type: skill",
				"    publish: false",
				"",
			].join("\n"),
			[{ name: "analysis", deps: ["experimental"] }, { name: "experimental" }],
		);

		const cap = captureOutput();
		try {
			await checkCommand(dir);
		} finally {
			cap.restore();
		}
		const allOutput = [...cap.warns, ...cap.logs].join("\n");
		expect(cap.warns.length).toBeGreaterThan(0);
		expect(allOutput).toContain("analysis");
		expect(allOutput).toContain("experimental");
		expect(allOutput).toMatch(/issue.*found/);
		expect(allOutput).toContain("--strict");
	});

	test("singular pluralization for exactly one issue", async () => {
		const dir = await makeProject(
			[
				"name: test",
				"dependencies:",
				"  analysis:",
				"    local: ./skills/analysis",
				"    type: skill",
				"  experimental:",
				"    local: ./skills/experimental",
				"    type: skill",
				"    publish: false",
				"",
			].join("\n"),
			[{ name: "analysis", deps: ["experimental"] }, { name: "experimental" }],
		);

		const cap = captureOutput();
		try {
			await checkCommand(dir);
		} finally {
			cap.restore();
		}
		const allOutput = cap.logs.join("\n");
		// 1 leaking root → "1 issue found" (singular)
		expect(allOutput).toMatch(/1 issue found/);
	});

	test("plural form for multiple issues", async () => {
		const dir = await makeProject(
			[
				"name: test",
				"dependencies:",
				"  analysis:",
				"    local: ./skills/analysis",
				"    type: skill",
				"  loader:",
				"    local: ./skills/loader",
				"    type: skill",
				"  experimental:",
				"    local: ./skills/experimental",
				"    type: skill",
				"    publish: false",
				"",
			].join("\n"),
			[
				{ name: "analysis", deps: ["loader"] },
				{ name: "loader", deps: ["experimental"] },
				{ name: "experimental" },
			],
		);

		const cap = captureOutput();
		try {
			await checkCommand(dir);
		} finally {
			cap.restore();
		}
		const allOutput = cap.logs.join("\n");
		expect(allOutput).toMatch(/2 issues found/);
	});

	test("--strict exits 1 when warnings are present", async () => {
		const dir = await makeProject(
			[
				"name: test",
				"dependencies:",
				"  analysis:",
				"    local: ./skills/analysis",
				"    type: skill",
				"  experimental:",
				"    local: ./skills/experimental",
				"    type: skill",
				"    publish: false",
				"",
			].join("\n"),
			[{ name: "analysis", deps: ["experimental"] }, { name: "experimental" }],
		);

		const cap = captureOutput();
		const origExit = process.exit;
		let exitCode: number | undefined;
		process.exit = ((c: number) => {
			exitCode = c;
			throw new Error(`exit ${c}`);
		}) as typeof process.exit;
		try {
			await checkCommand(dir, { strict: true });
		} catch {
			// Expected — mocked exit throws.
		} finally {
			process.exit = origExit;
			cap.restore();
		}
		expect(exitCode).toBe(1);
	});

	test("--strict with clean manifest does not exit", async () => {
		const dir = await makeProject(
			[
				"name: test",
				"dependencies:",
				"  foo:",
				"    local: ./skills/foo",
				"    type: skill",
				"",
			].join("\n"),
			[{ name: "foo" }],
		);

		const cap = captureOutput();
		const origExit = process.exit;
		let exitCode: number | undefined;
		process.exit = ((c: number) => {
			exitCode = c;
			throw new Error(`exit ${c}`);
		}) as typeof process.exit;
		try {
			await checkCommand(dir, { strict: true });
		} finally {
			process.exit = origExit;
			cap.restore();
		}
		expect(exitCode).toBeUndefined();
	});

	test("throws useful error when no manifest exists", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-check-cmd-"));
		await expect(checkCommand(tempDir)).rejects.toThrow();
	});
});
