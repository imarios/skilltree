import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { _resetDeprecationWarningsForTests } from "../../src/core/filenames.js";
import { scanRegistry } from "../../src/core/registry-scanner.js";

let tempDir: string;

async function setup(): Promise<string> {
	tempDir = join(
		tmpdir(),
		`skilltree-regscan-fb-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await mkdir(tempDir, { recursive: true });
	_resetDeprecationWarningsForTests();
	return tempDir;
}

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function createBareFixture(baseDir: string, files: Record<string, string>): Promise<string> {
	const sourceDir = join(baseDir, "source");
	await mkdir(sourceDir, { recursive: true });
	const git = simpleGit(sourceDir);
	await git.init();
	await git.addConfig("user.email", "test@test.com");
	await git.addConfig("user.name", "Test");
	for (const [path, content] of Object.entries(files)) {
		const fullPath = join(sourceDir, path);
		await mkdir(join(fullPath, ".."), { recursive: true });
		await writeFile(fullPath, content, "utf-8");
	}
	await git.add(".");
	await git.commit("initial");
	const bareDir = join(baseDir, "bare");
	await simpleGit().clone(sourceDir, bareDir, ["--bare"]);
	return bareDir;
}

const SKILL_FOO = `---
name: foo
description: Foo skill
---

# Foo
`;
const SKILL_BAR = `---
name: bar
description: Bar skill
---
`;
const SKILL_WIP = `---
name: wip
description: WIP skill
---
`;

describe("scanRegistry — fallback chain (Carbon Phase 2)", () => {
	test("curated skilltree-index.yml wins over manifest tier", async () => {
		// Curated says only 'curated-foo'; manifest says only 'foo'.
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skilltree-index.yml": `entities:
  - name: curated-foo
    type: skill
    path: skills/curated-foo
`,
			"skilltree.yml": `dependencies:
  foo:
    local: ./skills/foo
    type: skill
`,
			"skills/foo/SKILL.md": SKILL_FOO,
		});
		const entries = await scanRegistry(bareDir);
		expect(entries.map((e) => e.name).sort()).toEqual(["curated-foo"]);
	});

	test("manifest tier surfaces local entries when no curated index", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skilltree.yml": `dependencies:
  foo:
    local: ./skills/foo
    type: skill
`,
			"skills/foo/SKILL.md": SKILL_FOO,
		});
		const entries = await scanRegistry(bareDir);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.name).toBe("foo");
		expect(entries[0]?.type).toBe("skill");
		expect(entries[0]?.path).toBe("skills/foo");
		expect(entries[0]?.description).toBe("Foo skill");
	});

	test("manifest tier filters publish: false", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skilltree.yml": `dependencies:
  foo:
    local: ./skills/foo
    type: skill
  wip:
    local: ./skills/wip
    type: skill
    publish: false
`,
			"skills/foo/SKILL.md": SKILL_FOO,
			"skills/wip/SKILL.md": SKILL_WIP,
		});
		const entries = await scanRegistry(bareDir);
		expect(entries.map((e) => e.name).sort()).toEqual(["foo"]);
	});

	test("manifest tier ignores dev-dependencies local entries", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skilltree.yml": `dependencies:
  foo:
    local: ./skills/foo
    type: skill
dev-dependencies:
  bar:
    local: ./skills/bar
    type: skill
`,
			"skills/foo/SKILL.md": SKILL_FOO,
			"skills/bar/SKILL.md": SKILL_BAR,
		});
		const entries = await scanRegistry(bareDir);
		expect(entries.map((e) => e.name).sort()).toEqual(["foo"]);
	});

	test("manifest tier ignores remote (repo:) entries", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skilltree.yml": `dependencies:
  foo:
    local: ./skills/foo
    type: skill
  remote-thing:
    repo: github.com/x/y
    path: skills/remote-thing
`,
			"skills/foo/SKILL.md": SKILL_FOO,
		});
		const entries = await scanRegistry(bareDir);
		expect(entries.map((e) => e.name).sort()).toEqual(["foo"]);
	});

	test("falls through to dynamic scan when manifest has only dev-deps local entries", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skilltree.yml": `dev-dependencies:
  internal-tool:
    local: ./skills/internal-tool
    type: skill
`,
			// Author also has conventional layout skills not declared in manifest:
			"skills/foo/SKILL.md": SKILL_FOO,
			"skills/bar/SKILL.md": SKILL_BAR,
		});
		const entries = await scanRegistry(bareDir);
		// Tier 2 emits nothing (no visible local in `dependencies`) → tier 3 (dynamic) fires.
		expect(entries.map((e) => e.name).sort()).toEqual(["bar", "foo"]);
	});

	test("falls through to dynamic scan when manifest has no local entries", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skilltree.yml": `dependencies:
  remote-only:
    repo: github.com/x/y
    path: skills/x
`,
			"skills/foo/SKILL.md": SKILL_FOO,
		});
		const entries = await scanRegistry(bareDir);
		expect(entries.map((e) => e.name)).toEqual(["foo"]);
	});

	test("dynamic tier strips paths the manifest marks hidden (PS13 cross-filter)", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skilltree.yml": `dependencies:
  wip:
    local: ./skills/wip
    type: skill
    publish: false
`,
			"skills/foo/SKILL.md": SKILL_FOO,
			"skills/wip/SKILL.md": SKILL_WIP,
		});
		const entries = await scanRegistry(bareDir);
		// Tier 2 emits nothing (only entry is publish:false). Tier 3 finds both
		// foo and wip on disk, but the manifest marks `skills/wip` hidden, so
		// it's filtered out. Only `foo` surfaces. (spec PS13)
		expect(entries.map((e) => e.name).sort()).toEqual(["foo"]);
	});

	test("dynamic tier strips dev-dependency local paths (PS13 cross-filter)", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skilltree.yml": `dev-dependencies:
  internal:
    local: ./skills/internal
    type: skill
`,
			"skills/foo/SKILL.md": SKILL_FOO,
			"skills/internal/SKILL.md": `---
name: internal
description: Internal tool
---
`,
		});
		const entries = await scanRegistry(bareDir);
		// dev-dep local entry → tier 2 emits nothing → tier 3 runs and strips
		// `skills/internal` per the visibility predicate.
		expect(entries.map((e) => e.name).sort()).toEqual(["foo"]);
	});

	test("no manifest, no index → dynamic scan as today", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skills/foo/SKILL.md": SKILL_FOO,
			"skills/bar/SKILL.md": SKILL_BAR,
		});
		const entries = await scanRegistry(bareDir);
		expect(entries.map((e) => e.name).sort()).toEqual(["bar", "foo"]);
	});

	test("manifest tier uses YAML key as name when entry has no explicit name field", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skilltree.yml": `dependencies:
  my-alias:
    local: ./skills/foo
    type: skill
`,
			"skills/foo/SKILL.md": SKILL_FOO,
		});
		const entries = await scanRegistry(bareDir);
		expect(entries[0]?.name).toBe("my-alias");
	});

	test("manifest tier respects explicit name field over YAML key", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skilltree.yml": `dependencies:
  my-alias:
    local: ./skills/foo
    type: skill
    name: foo
`,
			"skills/foo/SKILL.md": SKILL_FOO,
		});
		const entries = await scanRegistry(bareDir);
		expect(entries[0]?.name).toBe("foo");
	});

	test("manifest tier infers type from path when not declared", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skilltree.yml": `dependencies:
  my-skill:
    local: ./skills/foo
  my-agent:
    local: ./agents/bar.md
`,
			"skills/foo/SKILL.md": SKILL_FOO,
			"agents/bar.md": `---
name: bar
description: Bar agent
---
`,
		});
		const entries = await scanRegistry(bareDir);
		const bySite = Object.fromEntries(entries.map((e) => [e.name, e]));
		expect(bySite["my-skill"]?.type).toBe("skill");
		expect(bySite["my-agent"]?.type).toBe("agent");
	});

	test("manifest tier skips absolute and ~ local paths (not part of repo)", async () => {
		const dir = await setup();
		const bareDir = await createBareFixture(dir, {
			"skilltree.yml": `dependencies:
  in-repo:
    local: ./skills/foo
    type: skill
  out-of-repo-abs:
    local: /tmp/abs/x
    type: skill
  out-of-repo-tilde:
    local: ~/x
    type: skill
`,
			"skills/foo/SKILL.md": SKILL_FOO,
		});
		const entries = await scanRegistry(bareDir);
		expect(entries.map((e) => e.name).sort()).toEqual(["in-repo"]);
	});
});
