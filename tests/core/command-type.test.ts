/**
 * Coverage for the `command` EntityType (Issue #11).
 *
 * Slash commands are a third first-class resource alongside skills and
 * agents. Like agents they're single `.md` files; unlike agents they
 * install under `commands/` (sibling to `skills/` and `agents/`),
 * matching Claude Code's slash-command layout.
 *
 * These tests pin down the cross-cutting behavior so the type doesn't
 * regress to "agent-with-a-rename":
 *  - install path is `commands/<name>.md`
 *  - install copies a single file (not a directory tree)
 *  - type inference picks `command` for `.md` files under any
 *    `commands/` segment, both on local disk and inside a git tree
 *  - repo and registry scanners label discovered files correctly
 *  - the gitignore helper covers `commands/` alongside skills+agents
 *  - lockfile round-trip preserves `type: command`
 *  - skills cannot depend on commands (extends the existing
 *    skill→agent invariant)
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { getSkillAgentIgnoreEntries } from "../../src/core/gitignore.js";
import type { ResolvedEntity } from "../../src/core/graph.js";
import { inferTypeFromGit, resolveAll } from "../../src/core/graph.js";
import { executeInstall, getTargetPath, planInstall } from "../../src/core/installer.js";
import { buildLockfile, parseLockfile, serializeLockfile } from "../../src/core/lockfile.js";
import { dynamicScanRepo } from "../../src/core/registry-scanner.js";
import { scanLocalRepo } from "../../src/core/repo-scanner.js";
import { createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

async function makeTempDir(prefix: string): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), prefix));
	return tempDir;
}

/**
 * Shared mixed-types fixture: a real git repo at tag v1.0.0 with a
 * command and an agent. Two different consumers (inferTypeFromGit,
 * dynamicScanRepo) want the same shape, and rebuilding a git tree per
 * test is expensive — fork+exec dominates the test runtime. Hoisted to
 * a beforeAll so the single bare clone amortizes across both tests.
 */
let mixedFixtureDir: string;
let mixedFixtureBare: string;
beforeAll(async () => {
	mixedFixtureDir = await mkdtemp(join(tmpdir(), "skilltree-cmd-fixture-"));
	const repoDir = await createTestRepo(
		mixedFixtureDir,
		"types-repo",
		[
			{ path: "commands/review.md", name: "review", isAgent: true },
			{ path: "agents/inspector.md", name: "inspector", isAgent: true },
		],
		"v1.0.0",
	);
	mixedFixtureBare = join(mixedFixtureDir, "bare.git");
	await simpleGit().clone(repoDir, mixedFixtureBare, ["--bare"]);
});

afterAll(async () => {
	if (mixedFixtureDir) {
		await rm(mixedFixtureDir, { recursive: true, force: true });
	}
});

describe("getTargetPath for commands", () => {
	test("returns commands/<name>.md for command entities", () => {
		const entity: ResolvedEntity = {
			key: "my-cmd",
			name: "my-cmd",
			type: "command",
			group: "prod",
			path: "./commands/my-cmd.md",
			commit: "HEAD",
			local: true,
			dependencies: [],
		};
		expect(getTargetPath(entity, "/project/.claude")).toBe("/project/.claude/commands/my-cmd.md");
	});

	test("commands and agents do not collide in the install layout", () => {
		// Same name, different type — must not produce the same path.
		const cmd: ResolvedEntity = {
			key: "review",
			name: "review",
			type: "command",
			group: "prod",
			path: "./commands/review.md",
			commit: "HEAD",
			local: true,
			dependencies: [],
		};
		const agent: ResolvedEntity = {
			key: "review",
			name: "review",
			type: "agent",
			group: "prod",
			path: "./agents/review.md",
			commit: "HEAD",
			local: true,
			dependencies: [],
		};
		expect(getTargetPath(cmd, "/p/.claude")).not.toBe(getTargetPath(agent, "/p/.claude"));
	});
});

describe("executeInstall for commands", () => {
	test("copies a command as a single .md file under commands/", async () => {
		const dir = await makeTempDir("skilltree-cmd-install-");
		const cmdsDir = join(dir, "commands");
		await mkdir(cmdsDir, { recursive: true });
		await writeFile(
			join(cmdsDir, "review.md"),
			"---\nname: review\ndescription: Review the diff\n---\n\nReview body\n",
		);

		const installBase = join(dir, "build", ".claude");
		const entities = new Map<string, ResolvedEntity>([
			[
				"command:review",
				{
					key: "review",
					name: "review",
					type: "command",
					group: "prod",
					path: "./commands/review.md",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);

		const plan = await planInstall(entities, ["command:review"], installBase, {
			installPath: installBase,
		});
		const integrityMap = await executeInstall(plan, dir, { installPath: installBase });

		const targetPath = join(installBase, "commands", "review.md");
		const stats = await lstat(targetPath);
		expect(stats.isFile()).toBe(true);
		expect(integrityMap.size).toBe(1);

		const content = await readFile(targetPath, "utf-8");
		expect(content).toContain("name: review");
	});

	test("creates the commands/ directory even when no commands install", async () => {
		// The install loop unconditionally creates skills/, agents/, and now
		// commands/ — so consumers always have a stable layout to drop files
		// into manually if they want.
		const dir = await makeTempDir("skilltree-cmd-mkdir-");
		const installBase = join(dir, ".claude");
		const plan = await planInstall(new Map(), [], installBase, {});
		await executeInstall(plan, dir, {});
		const stats = await lstat(join(installBase, "commands"));
		expect(stats.isDirectory()).toBe(true);
	});
});

describe("inferTypeFromGit for commands", () => {
	test("classifies .md under commands/ as command, .md under agents/ as agent", async () => {
		const cmdResult = await inferTypeFromGit(mixedFixtureBare, "v1.0.0", "commands/review.md");
		expect(cmdResult.type).toBe("command");

		const agentResult = await inferTypeFromGit(mixedFixtureBare, "v1.0.0", "agents/inspector.md");
		expect(agentResult.type).toBe("agent");
	});
});

describe("repo scanner labels commands", () => {
	test("scanLocalRepo classifies files under commands/ as type=command", async () => {
		const dir = await makeTempDir("skilltree-cmd-scan-");
		await mkdir(join(dir, "commands"), { recursive: true });
		await mkdir(join(dir, "agents"), { recursive: true });
		await writeFile(
			join(dir, "commands", "review.md"),
			"---\nname: review\ndescription: Slash command\n---\nbody\n",
		);
		await writeFile(
			join(dir, "agents", "inspector.md"),
			"---\nname: inspector\ndescription: Agent\n---\nbody\n",
		);

		const entries = await scanLocalRepo(dir);
		const review = entries.find((e) => e.name === "review");
		const inspector = entries.find((e) => e.name === "inspector");

		expect(review?.type).toBe("command");
		expect(inspector?.type).toBe("agent");
	});

	test("dynamicScanRepo on a git tree picks up commands too", async () => {
		const entries = await dynamicScanRepo(mixedFixtureBare);
		const types = new Map(entries.map((e) => [e.name, e.type]));
		expect(types.get("review")).toBe("command");
		expect(types.get("inspector")).toBe("agent");
	});
});

describe("gitignore covers commands/", () => {
	test("getSkillAgentIgnoreEntries returns skills/, agents/, and commands/", () => {
		const entries = getSkillAgentIgnoreEntries(".claude");
		expect(entries).toEqual([".claude/skills/", ".claude/agents/", ".claude/commands/"]);
	});
});

describe("lockfile round-trip for commands", () => {
	test("type: command serializes and parses back", () => {
		const entities = new Map<string, ResolvedEntity>([
			[
				"command:review",
				{
					key: "review",
					name: "review",
					type: "command",
					group: "prod",
					path: "./commands/review.md",
					commit: "HEAD",
					local: true,
					dependencies: [],
				},
			],
		]);
		const lockfile = buildLockfile(entities);
		const serialized = serializeLockfile(lockfile);
		const parsed = parseLockfile(serialized);
		expect(parsed.packages.review?.type).toBe("command");
	});
});

describe("graph type-constraint extends to commands", () => {
	test("a skill that depends on a command produces a clear type-constraint error", async () => {
		const dir = await makeTempDir("skilltree-cmd-deps-");

		// Build a local skill that declares a command as a dependency.
		// The resolver should refuse: skills can only depend on skills.
		await mkdir(join(dir, "my-skill"), { recursive: true });
		await writeFile(
			join(dir, "my-skill", "SKILL.md"),
			"---\nname: my-skill\ndependencies:\n  - review\n---\nBody\n",
		);
		await mkdir(join(dir, "commands"), { recursive: true });
		await writeFile(join(dir, "commands", "review.md"), "---\nname: review\n---\nBody\n");

		const result = await resolveAll(
			{
				dependencies: {
					"my-skill": { local: "./my-skill" },
					review: { local: "./commands/review.md", type: "command" },
				},
			},
			dir,
		);

		const errorText = result.errors.join("\n");
		expect(errorText).toContain("skill:my-skill");
		expect(errorText).toContain("command:review");
		expect(errorText).toContain("Skills can only depend on other skills");
	});
});

/**
 * Pin down the *positive* side of the type-constraint world: a slash
 * command is allowed to declare its own `dependencies:` in frontmatter,
 * and the resolver follows them like it does for skills and agents.
 *
 * `dependencies:` in a command `.md` is a skilltree extension — Claude
 * Code's native slash-command frontmatter spec doesn't define it. The
 * field is consumed at install time by the resolver and ignored at
 * runtime by Claude Code, the same way `dependencies:` works for
 * `SKILL.md`. These tests guard against a future refactor that
 * accidentally branches on type when reading frontmatter and silently
 * drops command deps.
 */
describe("command frontmatter dependencies are honored", () => {
	test("local command declaring `dependencies:` pulls in the transitive skill", async () => {
		const dir = await makeTempDir("skilltree-cmd-frontdeps-");

		await mkdir(join(dir, "skills", "code-review"), { recursive: true });
		await writeFile(
			join(dir, "skills", "code-review", "SKILL.md"),
			"---\nname: code-review\ndescription: Reviews code\n---\nBody\n",
		);
		await mkdir(join(dir, "commands"), { recursive: true });
		await writeFile(
			join(dir, "commands", "review.md"),
			"---\nname: review\ndescription: Slash command\ndependencies:\n  - code-review\n---\nBody\n",
		);

		const result = await resolveAll(
			{
				dependencies: {
					review: { local: "./commands/review.md", type: "command" },
					"code-review": { local: "./skills/code-review", type: "skill" },
				},
			},
			dir,
		);

		expect(result.errors).toEqual([]);

		// The command's frontmatter dep was registered on the entity.
		const cmd = result.entities.get("command:review");
		expect(cmd?.dependencies).toContain("code-review");

		// And the topo sort puts the skill before the command — proof the
		// edge made it into the graph, not just the entity record.
		const order = result.installOrder;
		expect(order.indexOf("skill:code-review")).toBeLessThan(order.indexOf("command:review"));
	});

	test("remote command's frontmatter `dependencies:` resolves transitively from the same repo", async () => {
		// End-to-end via a real git repo so we exercise readRemoteFrontmatter +
		// the same-repo conventional probe in one shot. This was the path my
		// manual UAT covered; pinning it as a test means a future regression
		// in remote frontmatter parsing won't slip through.
		const dir = await makeTempDir("skilltree-cmd-remote-frontdeps-");
		const repoDir = await createTestRepo(
			dir,
			"upstream",
			[
				{
					path: "commands/review.md",
					name: "review",
					isAgent: true,
					dependencies: ["code-review"],
				},
				{ path: "skills/code-review", name: "code-review" },
			],
			"v1.0.0",
		);
		const bareDir = join(dir, "bare.git");
		await simpleGit().clone(repoDir, bareDir, ["--bare"]);

		const result = await resolveAll(
			{
				dependencies: {
					review: {
						repo: `file://${bareDir}`,
						path: "commands/review.md",
						type: "command",
						version: "*",
					},
				},
			},
			dir,
		);

		expect(result.errors).toEqual([]);

		// `code-review` was never mentioned in the manifest; it must have come
		// from the command's frontmatter via the same-repo probe.
		const cmd = result.entities.get("command:review");
		expect(cmd?.type).toBe("command");
		expect(cmd?.dependencies).toContain("code-review");

		const transitive = result.entities.get("skill:code-review");
		expect(transitive?.type).toBe("skill");
		expect(transitive?.repo).toContain("bare.git");

		const order = result.installOrder;
		expect(order.indexOf("skill:code-review")).toBeLessThan(order.indexOf("command:review"));
	});

	test("command depending on another command is allowed (active resources can compose)", async () => {
		// Cross-resource dep on the active side: command -> command. The graph
		// permits this (only skill -> non-skill is rejected). Mostly a
		// guardrail so the type-constraint rule doesn't accidentally tighten
		// to "active resources may only depend on skills" without an explicit
		// design decision.
		const dir = await makeTempDir("skilltree-cmd-to-cmd-");
		await mkdir(join(dir, "commands"), { recursive: true });
		await writeFile(
			join(dir, "commands", "lint.md"),
			"---\nname: lint\ndescription: Lint command\n---\nBody\n",
		);
		await writeFile(
			join(dir, "commands", "full-review.md"),
			"---\nname: full-review\ndescription: Orchestrator\ndependencies:\n  - lint\n---\nBody\n",
		);

		const result = await resolveAll(
			{
				dependencies: {
					"full-review": { local: "./commands/full-review.md", type: "command" },
					lint: { local: "./commands/lint.md", type: "command" },
				},
			},
			dir,
		);

		expect(result.errors).toEqual([]);
		const parent = result.entities.get("command:full-review");
		expect(parent?.dependencies).toContain("lint");

		const order = result.installOrder;
		expect(order.indexOf("command:lint")).toBeLessThan(order.indexOf("command:full-review"));
	});
});
