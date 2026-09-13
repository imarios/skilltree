/**
 * Neon Phase 3 (#203): two spellings of one repo share one resolution.
 *
 * The #203 workaround wrote the same repo twice — once with a `.git` suffix —
 * so the resolver resolved each spelling independently and a removed skill
 * could stay on an old tag. `freeze` is the supported way to do that now, so
 * the loophole closes: respelling a repo no longer escapes its shared version,
 * and the messages that used to suggest splitting repos point at `freeze`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { resolveAll } from "../../src/core/graph.js";
import type { Dependency, Manifest } from "../../src/types.js";
import { createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string | undefined;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
	tempDir = undefined;
});

interface Spellings {
	dir: string;
	/** `file://…/agent-skills.git` */
	a: string;
	/** The same repo with a trailing slash. */
	b: string;
}

/** v0.4.0: removed-a, stable, agent-builder. v0.6.0: stable, kibana-agent-builder. */
async function buildFixture(): Promise<Spellings> {
	const dir = await mkdtemp(join(tmpdir(), "skilltree-spellings-"));
	tempDir = dir;
	const repoDir = await createTestRepo(
		dir,
		"agent-skills",
		[
			{ path: "skills/removed-a", name: "removed-a" },
			{ path: "skills/stable", name: "stable" },
			{ path: "skills/agent-builder", name: "agent-builder" },
		],
		"v0.4.0",
	);
	const git = simpleGit(repoDir);
	await git.rm(["-r", "skills/removed-a"]);
	await git.mv("skills/agent-builder", "skills/kibana-agent-builder");
	await writeFile(
		join(repoDir, "skills/kibana-agent-builder/SKILL.md"),
		"---\nname: kibana-agent-builder\n---\n\n# kibana-agent-builder\n",
	);
	await git.add(".");
	await git.commit("v0.6.0");
	await git.addTag("v0.6.0");

	const bareDir = join(dir, "agent-skills.git");
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	return { dir, a: `file://${bareDir}`, b: `file://${bareDir}/` };
}

function skill(repo: string, path: string, extra: Record<string, unknown>): Dependency {
	return { repo, path, type: "skill", ...extra } as Dependency;
}

describe("resolver: repo spellings share one resolution (#203)", () => {
	test("RS1 the old workaround no longer splits the repo; the capped warning suggests freeze", async () => {
		const fx = await buildFixture();
		const manifest: Manifest = {
			dependencies: {
				"removed-a": skill(fx.a, "skills/removed-a", { version: "<0.5.0" }),
				stable: skill(fx.b, "skills/stable", { version: "*" }),
			},
		};

		const result = await resolveAll(manifest, fx.dir);

		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:removed-a")?.version).toBe("0.4.0");
		expect(result.entities.get("skill:stable")?.version).toBe("0.4.0");
		const capped = result.warnings.find((w) => w.includes("capped at 0.4.0"));
		expect(capped).toContain("skilltree freeze");
	});

	test("RS2 incompatible pins across spellings are one conflict whose fix suggests freeze", async () => {
		const fx = await buildFixture();
		const manifest: Manifest = {
			dependencies: {
				"removed-a": skill(fx.a, "skills/removed-a", { version: "0.4.0" }),
				"kibana-agent-builder": skill(fx.b, "skills/kibana-agent-builder", { version: "^0.6.0" }),
			},
		};

		const result = await resolveAll(manifest, fx.dir);

		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("Version conflict");
		expect(result.errors[0]).toContain("skilltree freeze");
	});

	test("RS3 freezing is the supported replacement for the workaround", async () => {
		const fx = await buildFixture();
		const manifest: Manifest = {
			dependencies: {
				"removed-a": skill(fx.a, "skills/removed-a", { frozen: "0.4.0" }),
				"kibana-agent-builder": skill(fx.b, "skills/kibana-agent-builder", { version: "*" }),
			},
		};

		const result = await resolveAll(manifest, fx.dir);

		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:removed-a")?.version).toBe("0.4.0");
		expect(result.entities.get("skill:kibana-agent-builder")?.version).toBe("0.6.0");
	});

	test("RS4 a version conflict is reported once, not once per resolution pass", async () => {
		// Pre-existing: resolveRepoVersions runs twice (pack expansion), and a
		// conflict left nothing in repoResolutions to stop the second report.
		const fx = await buildFixture();
		const manifest: Manifest = {
			dependencies: {
				"removed-a": skill(fx.a, "skills/removed-a", { version: "0.4.0" }),
				"kibana-agent-builder": skill(fx.a, "skills/kibana-agent-builder", { version: "^0.6.0" }),
			},
		};

		const result = await resolveAll(manifest, fx.dir);

		expect(result.errors).toHaveLength(1);
	});
});
