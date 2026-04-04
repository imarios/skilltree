/**
 * Pre-refactoring tests for expandDeps (33) in manifest.ts.
 * Tests the complex source expansion logic that handles both
 * remote URLs and local filesystem paths in the sources map.
 */
import { describe, expect, test } from "bun:test";
import { expandSources, parseManifest } from "../../src/core/manifest.js";

describe("expandDeps: source expansion edge cases", () => {
	test("expands dev-dependencies with source alias", () => {
		const manifest = parseManifest(`
sources:
  org: github.com/org/skills
dependencies: {}
dev-dependencies:
  dev-tool:
    source: org
    path: skills/dev-tool
    version: "^1.0.0"
`);
		const expanded = expandSources(manifest);
		const dep = expanded["dev-dependencies"]?.["dev-tool"] as unknown as Record<string, unknown>;
		expect(dep?.repo).toBe("github.com/org/skills");
		expect(dep?.path).toBe("skills/dev-tool");
	});

	test("throws on unknown source alias", () => {
		const manifest = parseManifest(`
dependencies:
  my-skill:
    source: nonexistent
    path: skills/my-skill
`);
		expect(() => expandSources(manifest)).toThrow("Unknown source alias");
	});

	test("preserves non-source deps unchanged", () => {
		const manifest = parseManifest(`
dependencies:
  remote:
    repo: github.com/user/repo
    path: skills/remote
    version: "*"
  local:
    local: ./skills/local
`);
		const expanded = expandSources(manifest);
		const remote = expanded.dependencies?.remote as unknown as Record<string, unknown>;
		expect(remote?.repo).toBe("github.com/user/repo");
		const local = expanded.dependencies?.local as unknown as Record<string, unknown>;
		expect(local?.local).toBe("./skills/local");
	});

	test("expands local source preserving type field", () => {
		const manifest = parseManifest(`
sources:
  mine: ~/Projects/my-skills
dependencies:
  my-agent:
    source: mine
    path: agents/my-agent.md
    type: agent
`);
		const expanded = expandSources(manifest);
		const dep = expanded.dependencies?.["my-agent"] as unknown as Record<string, unknown>;
		expect(dep?.local).toContain("/Projects/my-skills/agents/my-agent.md");
		expect(dep?.type).toBe("agent");
	});

	test("local source with dot-path for path", () => {
		const manifest = parseManifest(`
sources:
  root: ~/Projects/single-skill
dependencies:
  single:
    source: root
    path: .
`);
		const expanded = expandSources(manifest);
		const dep = expanded.dependencies?.single as unknown as Record<string, unknown>;
		expect(dep?.local).toContain("/Projects/single-skill");
		expect((dep?.local as string).endsWith("/.")).toBe(false);
	});

	test("handles manifest with no sources section", () => {
		const manifest = parseManifest(`
dependencies:
  my-skill:
    repo: github.com/user/repo
    path: skills/my-skill
`);
		const expanded = expandSources(manifest);
		expect(expanded.dependencies?.["my-skill"]).toBeDefined();
	});

	test("handles manifest with empty dependencies", () => {
		const manifest = parseManifest(`
dependencies: {}
`);
		const expanded = expandSources(manifest);
		expect(expanded.dependencies).toEqual({});
	});

	test("handles manifest with no dependencies at all", () => {
		const manifest = parseManifest(`
name: empty-project
`);
		const expanded = expandSources(manifest);
		expect(expanded.dependencies).toBeUndefined();
	});
});
