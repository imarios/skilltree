import { describe, expect, test } from "bun:test";
import {
	expandSources,
	parseManifest,
	serializeManifest,
	validateManifest,
} from "../../src/core/manifest.js";

describe("parseManifest", () => {
	test("parses manifest with remote dependencies", () => {
		const yaml = `
name: my-project
dependencies:
  task-builder:
    repo: github.com/company/skills
    path: skills/task-builder
    version: "^2.0.0"
`;
		const manifest = parseManifest(yaml);
		expect(manifest.name).toBe("my-project");
		expect(manifest.dependencies?.["task-builder"]).toEqual({
			repo: "github.com/company/skills",
			path: "skills/task-builder",
			version: "^2.0.0",
		});
	});

	test("parses manifest with local dependencies", () => {
		const yaml = `
dependencies:
  cy-language:
    local: ./skills/cy-language
`;
		const manifest = parseManifest(yaml);
		expect(manifest.dependencies?.["cy-language"]).toEqual({
			local: "./skills/cy-language",
		});
	});

	test("parses manifest with source shorthands", () => {
		const yaml = `
sources:
  vibes: github.com/company/vibes
dependencies:
  python-coding:
    source: vibes
    path: skills/python-coding
    version: "^2.0.0"
`;
		const manifest = parseManifest(yaml);
		expect(manifest.sources?.vibes).toBe("github.com/company/vibes");
		expect(manifest.dependencies?.["python-coding"]).toEqual({
			source: "vibes",
			path: "skills/python-coding",
			version: "^2.0.0",
		});
	});

	test("parses manifest with both dependency groups", () => {
		const yaml = `
dependencies:
  task-builder:
    local: ./skills/task-builder
dev-dependencies:
  python-coding:
    repo: github.com/company/vibes
    path: skills/python-coding
    version: "^2.0.0"
`;
		const manifest = parseManifest(yaml);
		expect(manifest.dependencies?.["task-builder"]).toBeDefined();
		expect(manifest["dev-dependencies"]?.["python-coding"]).toBeDefined();
	});

	test("parses manifest with name aliasing", () => {
		const yaml = `
dependencies:
  workflow-builder-agent:
    local: ./agents/source/workflow-builder.md
    type: agent
    name: workflow-builder
`;
		const manifest = parseManifest(yaml);
		const dep = manifest.dependencies?.["workflow-builder-agent"];
		expect(dep).toBeDefined();
		expect((dep as { name?: string }).name).toBe("workflow-builder");
		expect((dep as { type?: string }).type).toBe("agent");
	});
});

describe("serializeManifest + roundtrip", () => {
	test("serializes and re-parses a manifest", () => {
		const original = parseManifest(`
name: roundtrip-test
dependencies:
  my-skill:
    repo: github.com/user/repo
    path: skills/my-skill
    version: "^1.0.0"
`);
		const serialized = serializeManifest(original);
		const reparsed = parseManifest(serialized);
		expect(reparsed.name).toBe("roundtrip-test");
		expect(reparsed.dependencies?.["my-skill"]).toEqual(original.dependencies?.["my-skill"]);
	});
});

describe("validateManifest", () => {
	test("errors on dependency missing repo/local", () => {
		const manifest = parseManifest(`
dependencies:
  broken:
    path: skills/broken
    version: "^1.0.0"
`);
		const errors = validateManifest(manifest);
		expect(errors.length).toBe(1);
		expect(errors[0]).toContain('must have either "repo"/"source" or "local"');
	});

	test("errors on dependency with both repo and local", () => {
		const manifest = parseManifest(`
dependencies:
  broken:
    repo: github.com/user/repo
    local: ./skills/broken
    path: skills/broken
`);
		const errors = validateManifest(manifest);
		expect(errors.some((e) => e.includes("mutually exclusive"))).toBe(true);
	});

	test("errors on remote dep missing path", () => {
		const manifest = parseManifest(`
dependencies:
  no-path:
    repo: github.com/user/repo
    version: "^1.0.0"
`);
		const errors = validateManifest(manifest);
		expect(errors.some((e) => e.includes('require a "path"'))).toBe(true);
	});

	test("errors on same key in both groups", () => {
		const manifest = parseManifest(`
dependencies:
  dupe:
    local: ./skills/dupe
dev-dependencies:
  dupe:
    local: ./skills/dupe
`);
		const errors = validateManifest(manifest);
		expect(errors.some((e) => e.includes("both dependencies and dev-dependencies"))).toBe(true);
	});
});

describe("expandSources", () => {
	test("expands source alias to repo URL", () => {
		const manifest = parseManifest(`
sources:
  vibes: github.com/company/vibes
dependencies:
  python-coding:
    source: vibes
    path: skills/python-coding
    version: "^2.0.0"
`);
		const expanded = expandSources(manifest);
		const dep = expanded.dependencies?.["python-coding"] as unknown as
			| Record<string, unknown>
			| undefined;
		expect(dep).toBeDefined();
		expect(dep?.repo).toBe("github.com/company/vibes");
		expect("source" in (dep ?? {})).toBe(false);
	});

	test("throws on unknown source alias", () => {
		const manifest = parseManifest(`
sources:
  vibes: github.com/company/vibes
dependencies:
  broken:
    source: nonexistent
    path: skills/broken
`);
		expect(() => expandSources(manifest)).toThrow('Unknown source alias "nonexistent"');
	});

	test("expands local source to LocalDependency", () => {
		const manifest = parseManifest(`
sources:
  mine: ~/Projects/my-skills
dependencies:
  python-coding:
    source: mine
    path: skills/python-coding
`);
		const expanded = expandSources(manifest);
		const dep = expanded.dependencies?.["python-coding"] as unknown as
			| Record<string, unknown>
			| undefined;
		expect(dep).toBeDefined();
		expect(dep?.local).toContain("/Projects/my-skills/skills/python-coding");
		expect(dep?._sourceDir).toContain("/Projects/my-skills");
		expect("repo" in (dep ?? {})).toBe(false);
		expect("source" in (dep ?? {})).toBe(false);
	});

	test("expands local source with ./ prefix", () => {
		const manifest = parseManifest(`
sources:
  nearby: ./sibling-repo
dependencies:
  some-skill:
    source: nearby
    path: skills/some-skill
`);
		const expanded = expandSources(manifest);
		const dep = expanded.dependencies?.["some-skill"] as unknown as
			| Record<string, unknown>
			| undefined;
		expect(dep).toBeDefined();
		expect(dep?.local).toBe("./sibling-repo/skills/some-skill");
		expect(dep?._sourceDir).toBe("./sibling-repo");
	});

	test("expands local source with absolute path", () => {
		const manifest = parseManifest(`
sources:
  abs: /opt/skills
dependencies:
  my-skill:
    source: abs
    path: skills/my-skill
`);
		const expanded = expandSources(manifest);
		const dep = expanded.dependencies?.["my-skill"] as unknown as
			| Record<string, unknown>
			| undefined;
		expect(dep).toBeDefined();
		expect(dep?.local).toBe("/opt/skills/skills/my-skill");
	});

	test("local source with path '.' uses source root", () => {
		const manifest = parseManifest(`
sources:
  mine: ~/Projects/single-skill
dependencies:
  single:
    source: mine
    path: .
`);
		const expanded = expandSources(manifest);
		const dep = expanded.dependencies?.single as unknown as Record<string, unknown> | undefined;
		expect(dep?.local).toContain("/Projects/single-skill");
		// Should NOT end with /. — just the source root
		expect((dep?.local as string).endsWith("/.")).toBe(false);
	});

	test("remote source still works after local source support", () => {
		const manifest = parseManifest(`
sources:
  org: github.com/org/shared-skills
  mine: ~/Projects/my-skills
dependencies:
  remote-skill:
    source: org
    path: skills/remote-skill
    version: "^2.0.0"
  local-skill:
    source: mine
    path: skills/local-skill
`);
		const expanded = expandSources(manifest);
		const remoteDep = expanded.dependencies?.["remote-skill"] as unknown as Record<string, unknown>;
		expect(remoteDep?.repo).toBe("github.com/org/shared-skills");
		expect("local" in remoteDep).toBe(false);

		const localDep = expanded.dependencies?.["local-skill"] as unknown as Record<string, unknown>;
		expect(localDep?.local).toContain("/Projects/my-skills/skills/local-skill");
		expect("repo" in localDep).toBe(false);
	});

	test("preserves type and name on local source deps", () => {
		const manifest = parseManifest(`
sources:
  mine: ~/Projects/my-skills
dependencies:
  my-agent:
    source: mine
    path: agents/my-agent.md
    type: agent
    name: my-agent
`);
		const expanded = expandSources(manifest);
		const dep = expanded.dependencies?.["my-agent"] as unknown as Record<string, unknown>;
		expect(dep?.type).toBe("agent");
		expect(dep?.name).toBe("my-agent");
	});

	test("parses manifest with vendor field", () => {
		const manifest = parseManifest(`
name: my-project
vendor: true
dependencies: {}
`);
		expect(manifest.vendor).toBe(true);
	});

	test("vendor field defaults to undefined", () => {
		const manifest = parseManifest(`
name: my-project
dependencies: {}
`);
		expect(manifest.vendor).toBeUndefined();
	});

	test("vendor field roundtrips through serialize", () => {
		const original = parseManifest(`
name: test
vendor: true
dependencies: {}
`);
		const serialized = serializeManifest(original);
		const reparsed = parseManifest(serialized);
		expect(reparsed.vendor).toBe(true);
	});
});
