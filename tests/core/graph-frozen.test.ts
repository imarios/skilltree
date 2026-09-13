/**
 * Neon Phase 1 (#203): a frozen dep resolves at its own exact tag, outside its
 * repo's shared version.
 *
 * The fixture reproduces the elastic/agent-skills case: v0.6.0 removed
 * skills that existed at v0.4.0 and renamed another. Without `frozen:`, no
 * manifest can keep the removed skills and take the renamed path at once.
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

interface Fixture {
	dir: string;
	repoDir: string;
	bareDir: string;
	repo: string;
}

/**
 * v0.4.0: removed-a (→ helper-a), removed-b (→ stable), helper-a, stable, agent-builder
 * v0.6.0: stable (edited), kibana-agent-builder (renamed from agent-builder)
 */
async function buildElasticFixture(): Promise<Fixture> {
	const dir = await mkdtemp(join(tmpdir(), "skilltree-frozen-"));
	tempDir = dir;
	const repoDir = await createTestRepo(
		dir,
		"agent-skills",
		[
			{ path: "skills/removed-a", name: "removed-a", dependencies: ["helper-a"] },
			{ path: "skills/removed-b", name: "removed-b", dependencies: ["stable"] },
			{ path: "skills/helper-a", name: "helper-a" },
			{ path: "skills/stable", name: "stable" },
			{ path: "skills/agent-builder", name: "agent-builder" },
		],
		"v0.4.0",
	);

	const git = simpleGit(repoDir);
	await git.rm(["-r", "skills/removed-a", "skills/removed-b", "skills/helper-a"]);
	await git.mv("skills/agent-builder", "skills/kibana-agent-builder");
	await writeFile(
		join(repoDir, "skills/kibana-agent-builder/SKILL.md"),
		"---\nname: kibana-agent-builder\n---\n\n# kibana-agent-builder\n",
	);
	await writeFile(
		join(repoDir, "skills/stable/SKILL.md"),
		"---\nname: stable\n---\n\n# stable v0.6.0\n",
	);
	await git.add(".");
	await git.commit("v0.6.0: remove and rename skills");
	await git.addTag("v0.6.0");

	const bareDir = join(dir, "agent-skills.git");
	await simpleGit().clone(repoDir, bareDir, ["--bare"]);
	return { dir, repoDir, bareDir, repo: `file://${bareDir}` };
}

async function tagCommit(bareDir: string, tag: string): Promise<string> {
	return (await simpleGit(bareDir).revparse([`${tag}^{commit}`])).trim();
}

function skill(repo: string, path: string, extra: Record<string, unknown>): Dependency {
	return { repo, path, type: "skill", ...extra } as Dependency;
}

describe("resolver: frozen deps (#203)", () => {
	test("FZ1 frozen removed skill and renamed survivor resolve together, no cap warning", async () => {
		const fx = await buildElasticFixture();
		const manifest = {
			dependencies: {
				"removed-a": skill(fx.repo, "skills/removed-a", { frozen: "0.4.0" }),
				"kibana-agent-builder": skill(fx.repo, "skills/kibana-agent-builder", { version: "*" }),
			},
		} as Manifest;

		const result = await resolveAll(manifest, fx.dir);

		expect(result.errors).toEqual([]);
		const removed = result.entities.get("skill:removed-a");
		expect(removed?.version).toBe("0.4.0");
		expect(removed?.commit).toBe(await tagCommit(fx.bareDir, "v0.4.0"));
		expect(removed?.frozen).toBe("0.4.0");
		expect(result.entities.get("skill:kibana-agent-builder")?.version).toBe("0.6.0");
		expect(result.warnings.filter((w) => w.includes("capped at"))).toEqual([]);
	});

	test("FZ2 without frozen, a <0.5.0 pin still caps the survivor where the renamed path is missing", async () => {
		const fx = await buildElasticFixture();
		const manifest = {
			dependencies: {
				"removed-a": skill(fx.repo, "skills/removed-a", { version: "<0.5.0" }),
				"kibana-agent-builder": skill(fx.repo, "skills/kibana-agent-builder", { version: "*" }),
			},
		} as Manifest;

		const result = await resolveAll(manifest, fx.dir);

		expect(result.errors.some((e) => e.includes("kibana-agent-builder"))).toBe(true);
	});

	test("FZ3 two deps in one repo frozen at different tags each keep their own commit", async () => {
		const fx = await buildElasticFixture();
		const manifest = {
			dependencies: {
				"removed-a": skill(fx.repo, "skills/removed-a", { frozen: "0.4.0" }),
				stable: skill(fx.repo, "skills/stable", { frozen: "0.6.0" }),
			},
		} as Manifest;

		const result = await resolveAll(manifest, fx.dir);

		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:removed-a")?.commit).toBe(
			await tagCommit(fx.bareDir, "v0.4.0"),
		);
		expect(result.entities.get("skill:stable")?.commit).toBe(await tagCommit(fx.bareDir, "v0.6.0"));
		expect(result.entities.get("skill:stable")?.version).toBe("0.6.0");
	});

	test("FZ4 a frozen skill's same-repo dependency resolves at the frozen tag", async () => {
		const fx = await buildElasticFixture();
		const manifest = {
			dependencies: {
				"removed-a": skill(fx.repo, "skills/removed-a", { frozen: "0.4.0" }),
				"kibana-agent-builder": skill(fx.repo, "skills/kibana-agent-builder", { version: "*" }),
			},
		} as Manifest;

		const result = await resolveAll(manifest, fx.dir);

		expect(result.errors).toEqual([]);
		const helper = result.entities.get("skill:helper-a");
		expect(helper?.version).toBe("0.4.0");
		expect(helper?.commit).toBe(await tagCommit(fx.bareDir, "v0.4.0"));
		expect(helper?.frozen).toBe("0.4.0");
	});

	test("FZ5 a transitive dep the consumer declares unfrozen keeps the shared version", async () => {
		const fx = await buildElasticFixture();
		const manifest = {
			dependencies: {
				"removed-b": skill(fx.repo, "skills/removed-b", { frozen: "0.4.0" }),
				stable: skill(fx.repo, "skills/stable", { version: "*" }),
				"kibana-agent-builder": skill(fx.repo, "skills/kibana-agent-builder", { version: "*" }),
			},
		} as Manifest;

		const result = await resolveAll(manifest, fx.dir);

		expect(result.errors).toEqual([]);
		const stable = result.entities.get("skill:stable");
		expect(stable?.version).toBe("0.6.0");
		expect(stable?.frozen).toBeUndefined();
	});

	test("FZ6 an unfrozen tighter sibling still produces the capped warning", async () => {
		const fx = await buildElasticFixture();
		const manifest = {
			dependencies: {
				"agent-builder": skill(fx.repo, "skills/agent-builder", { version: "*" }),
				stable: skill(fx.repo, "skills/stable", { version: "^0.4.0" }),
			},
		} as Manifest;

		const result = await resolveAll(manifest, fx.dir);

		expect(result.errors).toEqual([]);
		expect(result.warnings.some((w) => w.includes("capped at 0.4.0"))).toBe(true);
	});

	test("FZ7 a frozen tag that doesn't exist is an error naming the dep, tag and repo", async () => {
		const fx = await buildElasticFixture();
		const manifest = {
			dependencies: {
				"removed-a": skill(fx.repo, "skills/removed-a", { frozen: "0.5.0" }),
			},
		} as Manifest;

		const result = await resolveAll(manifest, fx.dir);

		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("removed-a");
		expect(result.errors[0]).toContain("0.5.0");
		expect(result.errors[0]).toContain(fx.repo);
	});

	test.each([
		["v0.4.0", "v0.4.0"],
		["0.4.0", "v0.4.0"],
		["v0.7.0", "0.7.0"],
		["0.7.0", "0.7.0"],
	])("FZ8 frozen %p matches tag %p", async (frozen, tag) => {
		const fx = await buildElasticFixture();
		if (tag === "0.7.0") {
			await simpleGit(fx.repoDir).addTag("0.7.0");
			await simpleGit(fx.bareDir).raw([
				"fetch",
				`file://${fx.repoDir}`,
				"+refs/tags/*:refs/tags/*",
			]);
		}
		const manifest = {
			dependencies: { stable: skill(fx.repo, "skills/stable", { frozen }) },
		} as Manifest;

		const result = await resolveAll(manifest, fx.dir);

		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:stable")?.commit).toBe(await tagCommit(fx.bareDir, tag));
	});
});
