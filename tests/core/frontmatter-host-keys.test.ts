import { describe, expect, test } from "bun:test";
import { validateFrontmatter } from "../../src/core/frontmatter.js";
import type { EntityType } from "../../src/types.js";

// Every frontmatter field Claude Code documents for each entity type (#223).
// The allowlist used to grow one bug report at a time (#159, #160), so a
// correct entity failed `check` whenever it used a field nobody had reported
// yet. When the host documents a new field, add a row here.
//
//   agent:   https://code.claude.com/docs/en/sub-agents
//   skill:   https://code.claude.com/docs/en/skills (+ https://agentskills.io/specification)
//   command: same reference as skills, minus `name` and `paths`
const DOCUMENTED_KEYS: Record<EntityType, string[]> = {
	agent: [
		"name",
		"description",
		"tools",
		"disallowedTools",
		"model",
		"permissionMode",
		"maxTurns",
		"skills",
		"mcpServers",
		"hooks",
		"memory",
		"background",
		"omitClaudeMd",
		"effort",
		"isolation",
		"color",
		"initialPrompt",
		"experimental",
	],
	skill: [
		"name",
		"description",
		"when_to_use",
		"argument-hint",
		"arguments",
		"disable-model-invocation",
		"user-invocable",
		"allowed-tools",
		"disallowed-tools",
		"model",
		"effort",
		"context",
		"agent",
		"background",
		"hooks",
		"paths",
		"shell",
		"metadata",
		"license",
		"compatibility",
	],
	command: [
		"description",
		"when_to_use",
		"argument-hint",
		"arguments",
		"disable-model-invocation",
		"user-invocable",
		"allowed-tools",
		"disallowed-tools",
		"model",
		"effort",
		"context",
		"agent",
		"background",
		"hooks",
		"shell",
		"metadata",
		"license",
		"compatibility",
	],
};

// `name` and `description` are always present so the file is otherwise clean;
// every other documented key gets a placeholder scalar (the linter only
// checks the shape of the fields skilltree itself reads).
function frontmatterWith(key: string): string {
	const fields: Record<string, string> = { name: "foo", description: "x", [key]: "x" };
	const yaml = Object.entries(fields)
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n");
	return `---\n${yaml}\n---\n\n# foo\n`;
}

const cases = Object.entries(DOCUMENTED_KEYS).flatMap(([type, keys]) =>
	keys.map((key) => [type as EntityType, key] as const),
);

describe("documented host frontmatter keys (#223)", () => {
	test.each(cases)("%s accepts '%s'", (entityType, key) => {
		const issues = validateFrontmatter(frontmatterWith(key), { entityName: "foo", entityType });
		expect(issues.filter((i) => i.message.includes("unknown frontmatter key"))).toEqual([]);
	});

	// The allowlist still exists to catch typos (#124): near-misses of real
	// fields must keep failing, or completing the list would have quietly
	// turned the linter off.
	const typos: Array<[EntityType, string]> = [
		["agent", "mcpServer"],
		["agent", "permission-mode"],
		["skill", "allowed_tools"],
		["skill", "userInvocable"],
		["command", "argument_hint"],
	];

	test.each(typos)("%s still rejects the typo '%s'", (entityType, key) => {
		const issues = validateFrontmatter(frontmatterWith(key), { entityName: "foo", entityType });
		expect(issues).toContainEqual({
			kind: "error",
			field: key,
			message: `unknown frontmatter key '${key}'`,
		});
	});
});
