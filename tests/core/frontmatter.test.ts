import { describe, expect, test } from "bun:test";
import { getDeclaredDeps, parseFrontmatter } from "../../src/core/frontmatter.js";

describe("parseFrontmatter", () => {
	test("parses valid frontmatter with all fields", () => {
		const content = `---
name: api-development
description: Building REST APIs
dependencies:
  - python-coding
  - testing
---

# Body content here
`;
		const result = parseFrontmatter(content);
		expect(result).toEqual({
			name: "api-development",
			description: "Building REST APIs",
			dependencies: ["python-coding", "testing"],
		});
	});

	test("parses frontmatter with dependencies only", () => {
		const content = `---
dependencies:
  - task-builder
---
Body`;
		const result = parseFrontmatter(content);
		expect(result).toEqual({
			dependencies: ["task-builder"],
		});
	});

	test("parses empty frontmatter", () => {
		const content = `---
---
Body`;
		const result = parseFrontmatter(content);
		expect(result).toEqual({});
	});

	test("ignores extra fields", () => {
		const content = `---
name: my-skill
custom_field: ignored
dependencies:
  - dep-a
---`;
		const result = parseFrontmatter(content);
		expect(result).toEqual({
			name: "my-skill",
			dependencies: ["dep-a"],
		});
	});

	test("returns null for content with no frontmatter", () => {
		const content = "# Just a markdown file\n\nNo frontmatter here.";
		const result = parseFrontmatter(content);
		expect(result).toBeNull();
	});

	test("throws on malformed frontmatter (missing closing ---)", () => {
		const content = `---
name: broken
dependencies:
  - dep-a
`;
		expect(() => parseFrontmatter(content)).toThrow("missing closing ---");
	});

	test("filters out non-string dependency entries", () => {
		const content = `---
dependencies:
  - valid-dep
  - 123
  - true
  - another-dep
---`;
		const result = parseFrontmatter(content);
		expect(result?.dependencies).toEqual(["valid-dep", "another-dep"]);
	});

	test("parses agent skills: field (comma-separated string)", () => {
		const content = `---
name: my-agent
skills: runbooks-manager, cybersecurity-analyst
---
# Agent`;
		const result = parseFrontmatter(content);
		expect(result?.skills).toEqual(["runbooks-manager", "cybersecurity-analyst"]);
	});

	test("parses agent skills: field (YAML array)", () => {
		const content = `---
name: my-agent
skills:
  - runbooks-manager
  - cybersecurity-analyst
---`;
		const result = parseFrontmatter(content);
		expect(result?.skills).toEqual(["runbooks-manager", "cybersecurity-analyst"]);
	});

	test("parses agent skills: field (single value)", () => {
		const content = `---
name: my-agent
skills: runbooks-manager
---`;
		const result = parseFrontmatter(content);
		expect(result?.skills).toEqual(["runbooks-manager"]);
	});
});

describe("getDeclaredDeps", () => {
	test("merges dependencies and skills fields", () => {
		const fm = parseFrontmatter(`---
name: mixed
dependencies:
  - dep-a
skills: skill-b, skill-c
---`);
		const deps = getDeclaredDeps(fm ?? {});
		expect(deps).toContain("dep-a");
		expect(deps).toContain("skill-b");
		expect(deps).toContain("skill-c");
	});

	test("deduplicates across fields", () => {
		const fm = parseFrontmatter(`---
dependencies:
  - shared
skills: shared
---`);
		const deps = getDeclaredDeps(fm ?? {});
		expect(deps.filter((d) => d === "shared").length).toBe(1);
	});

	test("handles missing fields", () => {
		const fm = parseFrontmatter(`---
name: empty
---`);
		const deps = getDeclaredDeps(fm ?? {});
		expect(deps).toEqual([]);
	});
});
