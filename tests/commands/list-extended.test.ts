import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCommand } from "../../src/commands/list.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

function captureConsole(): { logs: string[]; restore: () => void } {
	const logs: string[] = [];
	const originalLog = console.log;
	console.log = (...args: unknown[]) => logs.push(args.join(" "));
	return { logs, restore: () => (console.log = originalLog) };
}

const LOCKFILE_WITH_DEPS = `lockfile_version: 1
packages:
  my-skill:
    type: skill
    group: prod
    source: local
    path: ./skills/my-skill
    commit: HEAD
    dependencies: []
  dev-skill:
    type: skill
    group: dev
    source: local
    path: ./skills/dev-skill
    commit: HEAD
    dependencies: []
`;

describe("listCommand extended", () => {
	test("--json outputs JSON array", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		await writeFile(join(tempDir, "skilltree.yml"), "name: test\n");
		await writeFile(join(tempDir, "skilltree.lock"), LOCKFILE_WITH_DEPS);

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir, { json: true });
		} finally {
			restore();
		}

		const json = JSON.parse(logs.join(""));
		expect(Array.isArray(json)).toBe(true);
		expect(json.length).toBe(2);
		expect(json.some((r: { name: string }) => r.name === "my-skill")).toBe(true);
	});

	test("--json with empty lockfile outputs empty array", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		await writeFile(join(tempDir, "skilltree.yml"), "name: test\n");

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir, { json: true });
		} finally {
			restore();
		}
		expect(logs.join("").trim()).toBe("[]");
	});

	test("--global with no global lockfile shows empty message", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		const globalDir = join(tempDir, "global");
		await mkdir(globalDir, { recursive: true });

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir, { global: true, globalDir });
		} finally {
			restore();
		}
		expect(logs.some((l) => l.includes("No global dependencies"))).toBe(true);
	});

	test("--global lists global deps without Group column", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		const globalDir = join(tempDir, "global");
		await mkdir(globalDir, { recursive: true });
		await writeFile(
			join(globalDir, "global.lock"),
			"lockfile_version: 1\npackages:\n  global-skill:\n    type: skill\n    group: prod\n    source: local\n    path: ~/skills/global-skill\n    commit: HEAD\n    dependencies: []\n",
		);

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir, { global: true, globalDir });
		} finally {
			restore();
		}
		expect(logs.some((l) => l.includes("global-skill"))).toBe(true);
		// Global table should NOT have Group column header
		expect(logs.some((l) => l.includes("Group"))).toBe(false);
	});

	test("project list shows Group column", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		await writeFile(join(tempDir, "skilltree.yml"), "name: test\n");
		await writeFile(join(tempDir, "skilltree.lock"), LOCKFILE_WITH_DEPS);

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir);
		} finally {
			restore();
		}
		expect(logs.some((l) => l.includes("Group"))).toBe(true);
	});

	test("shows remote dep version and source", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		await writeFile(join(tempDir, "skilltree.yml"), "name: test\n");
		await writeFile(
			join(tempDir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  remote-skill:\n    type: skill\n    group: prod\n    repo: github.com/org/skills\n    path: skills/remote-skill\n    version: 2.1.3\n    commit: abc123\n    integrity: sha256-xyz\n    dependencies: []\n",
		);

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir);
		} finally {
			restore();
		}
		expect(logs.some((l) => l.includes("2.1.3"))).toBe(true);
		expect(logs.some((l) => l.includes("github.com/org/skills"))).toBe(true);
	});

	test("unpinned remote dep shows @<short-sha> instead of '-' (issue #76)", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		await writeFile(join(tempDir, "skilltree.yml"), "name: test\n");
		await writeFile(
			join(tempDir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  unpinned-skill:\n    type: skill\n    group: prod\n    repo: github.com/org/skills\n    path: skills/unpinned-skill\n    commit: a56045e1234567890abcdef0123456789abcdef0\n    dependencies: []\n",
		);

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir);
		} finally {
			restore();
		}
		// Should surface the commit SHA, not a literal "-"
		expect(logs.some((l) => l.includes("@a56045e"))).toBe(true);
		// Must NOT show the unhelpful "-" placeholder in the version column
		const dataRows = logs.filter((l) => l.includes("unpinned-skill"));
		expect(dataRows.some((l) => / - /.test(l))).toBe(false);
	});

	test("publisher: lists defined packs in text output when manifest has packs: (#143)", async () => {
		// Publisher repos define packs for downstream consumers without
		// necessarily consuming the pack themselves. `list` previously read only
		// the lockfile, so maintainers had no way to confirm what packs their
		// repo publishes without grepping skilltree.yml. Show a footer listing
		// each defined pack with its member count.
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-packs-"));
		await writeFile(
			join(tempDir, "skilltree.yml"),
			[
				"name: publisher",
				"packs:",
				"  my-stack:",
				"    - local: ./skills/a",
				"    - local: ./skills/b",
				"  small-pack:",
				"    - local: ./skills/c",
				"",
			].join("\n"),
		);
		await writeFile(join(tempDir, "skilltree.lock"), LOCKFILE_WITH_DEPS);

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir);
		} finally {
			restore();
		}
		const joined = logs.join("\n");
		expect(joined).toMatch(/Defined packs/i);
		expect(joined).toMatch(/my-stack/);
		expect(joined).toMatch(/small-pack/);
		// Member counts are surfaced so maintainers can sanity-check expansion.
		expect(joined).toMatch(/2 members?/);
		expect(joined).toMatch(/1 member/);
	});

	test("publisher: empty lockfile still surfaces defined packs (#143)", async () => {
		// Pure publisher repo — packs defined but nothing installed locally. The
		// previous "No dependencies installed" early-return swallowed the packs
		// summary entirely.
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-packs-empty-"));
		await writeFile(
			join(tempDir, "skilltree.yml"),
			["name: pure-publisher", "packs:", "  only-pack:", "    - local: ./skills/x", ""].join("\n"),
		);

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir);
		} finally {
			restore();
		}
		const joined = logs.join("\n");
		expect(joined).toMatch(/Defined packs/i);
		expect(joined).toMatch(/only-pack/);
	});

	test("no packs: section → list output omits the Defined packs section (#143)", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-nopacks-"));
		await writeFile(join(tempDir, "skilltree.yml"), "name: test\n");
		await writeFile(join(tempDir, "skilltree.lock"), LOCKFILE_WITH_DEPS);

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir);
		} finally {
			restore();
		}
		const joined = logs.join("\n");
		expect(joined).not.toMatch(/Defined packs/i);
	});

	test("consumer: text output shows 'Via Pack' column when pack-attributed entries exist (#153)", async () => {
		// Resolver expands packs into N flat members before writing the lockfile.
		// Without the via_pack column the consumer can't tell which top-level
		// pack reference each row came from.
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-viapack-"));
		await writeFile(join(tempDir, "skilltree.yml"), "name: test\n");
		await writeFile(
			join(tempDir, "skilltree.lock"),
			[
				"lockfile_version: 1",
				"packages:",
				"  elastic-architect:",
				"    type: skill",
				"    group: prod",
				"    repo: github.com/marios-oss/elastic-skills",
				"    path: skills/elastic-architect",
				"    version: 0.1.5",
				"    commit: abc1234",
				"    via_pack: elastic-stack",
				"    dependencies: []",
				"  esql-details:",
				"    type: skill",
				"    group: prod",
				"    repo: github.com/marios-oss/elastic-skills",
				"    path: skills/esql-details",
				"    version: 0.1.5",
				"    commit: abc1234",
				"    via_pack: elastic-stack",
				"    dependencies: []",
				"  standalone:",
				"    type: skill",
				"    group: prod",
				"    repo: github.com/user/skills",
				"    path: skills/standalone",
				"    version: 1.0.0",
				"    commit: def5678",
				"    dependencies: []",
				"",
			].join("\n"),
		);

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir);
		} finally {
			restore();
		}

		const joined = logs.join("\n");
		expect(joined).toMatch(/Via Pack/);
		// Pack-injected rows surface the pack name; the standalone row stays blank.
		const elasticRow = logs.find((l) => l.includes("elastic-architect"));
		expect(elasticRow).toMatch(/elastic-stack/);
		const standaloneRow = logs.find((l) => l.includes("standalone"));
		expect(standaloneRow).not.toMatch(/elastic-stack/);
	});

	test("consumer: text output omits 'Via Pack' column when no entry has via_pack (#153)", async () => {
		// Don't clutter the table for projects that don't use packs at all.
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-noviapack-"));
		await writeFile(join(tempDir, "skilltree.yml"), "name: test\n");
		await writeFile(join(tempDir, "skilltree.lock"), LOCKFILE_WITH_DEPS);

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir);
		} finally {
			restore();
		}
		const joined = logs.join("\n");
		expect(joined).not.toMatch(/Via Pack/);
	});

	test("--json: pack-attributed rows include viaPack field; others omit it (#153)", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-viapack-json-"));
		await writeFile(join(tempDir, "skilltree.yml"), "name: test\n");
		await writeFile(
			join(tempDir, "skilltree.lock"),
			[
				"lockfile_version: 1",
				"packages:",
				"  elastic-architect:",
				"    type: skill",
				"    group: prod",
				"    repo: github.com/marios-oss/elastic-skills",
				"    path: skills/elastic-architect",
				"    version: 0.1.5",
				"    commit: abc1234",
				"    via_pack: elastic-stack",
				"    dependencies: []",
				"  standalone:",
				"    type: skill",
				"    group: prod",
				"    repo: github.com/user/skills",
				"    path: skills/standalone",
				"    version: 1.0.0",
				"    commit: def5678",
				"    dependencies: []",
				"",
			].join("\n"),
		);

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir, { json: true });
		} finally {
			restore();
		}

		const json = JSON.parse(logs.join("")) as Array<{ name: string; viaPack?: string }>;
		const elastic = json.find((r) => r.name === "elastic-architect");
		const standalone = json.find((r) => r.name === "standalone");
		expect(elastic?.viaPack).toBe("elastic-stack");
		expect(standalone).toBeDefined();
		expect(standalone?.viaPack).toBeUndefined();
		// Back-compat: output is still a bare array, not an object wrapper.
		expect(Array.isArray(json)).toBe(true);
	});

	test("--json includes commit field and omits '-' version for unpinned remote dep (issue #76)", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-list-"));
		await writeFile(join(tempDir, "skilltree.yml"), "name: test\n");
		await writeFile(
			join(tempDir, "skilltree.lock"),
			"lockfile_version: 1\npackages:\n  unpinned-skill:\n    type: skill\n    group: prod\n    repo: github.com/org/skills\n    path: skills/unpinned-skill\n    commit: a56045e1234567890abcdef0123456789abcdef0\n    dependencies: []\n  pinned-skill:\n    type: skill\n    group: prod\n    repo: github.com/org/skills\n    path: skills/pinned-skill\n    version: 2.1.3\n    commit: deadbeefcafebabe1234567890abcdef01234567\n    dependencies: []\n",
		);

		const { logs, restore } = captureConsole();
		try {
			await listCommand(tempDir, { json: true });
		} finally {
			restore();
		}

		const json = JSON.parse(logs.join("")) as Array<{
			name: string;
			version?: string;
			commit?: string;
		}>;
		const unpinned = json.find((r) => r.name === "unpinned-skill");
		const pinned = json.find((r) => r.name === "pinned-skill");

		// Unpinned: no literal "-" for version, commit surfaced
		expect(unpinned).toBeDefined();
		expect(unpinned?.version).not.toBe("-");
		expect(unpinned?.commit).toBe("a56045e1234567890abcdef0123456789abcdef0");

		// Pinned: version preserved, commit still surfaced
		expect(pinned?.version).toBe("2.1.3");
		expect(pinned?.commit).toBe("deadbeefcafebabe1234567890abcdef01234567");
	});
});
