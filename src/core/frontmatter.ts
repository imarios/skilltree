import YAML from "yaml";
import type { SkillFrontmatter } from "../types.js";

/**
 * Parse YAML frontmatter from a markdown file's content.
 * Frontmatter is delimited by `---` at the start and end.
 *
 * Reads dependencies from two fields:
 * - `dependencies:` — SKILL.md standard (YAML array)
 * - `skills:` — Agent .md standard (comma-separated string or YAML array)
 *
 * Both are normalized into string arrays on the result.
 */
export function parseFrontmatter(content: string): SkillFrontmatter | null {
	const trimmed = content.trimStart();
	if (!trimmed.startsWith("---")) {
		return null;
	}

	const endIndex = trimmed.indexOf("---", 3);
	if (endIndex === -1) {
		throw new Error("Malformed frontmatter: missing closing ---");
	}

	const yamlContent = trimmed.slice(3, endIndex).trim();
	if (!yamlContent) {
		return {};
	}

	const parsed = YAML.parse(yamlContent) as Record<string, unknown>;
	if (parsed === null || typeof parsed !== "object") {
		return {};
	}

	const result: SkillFrontmatter = {};

	if (typeof parsed.name === "string") {
		result.name = parsed.name;
	}

	if (typeof parsed.description === "string") {
		result.description = parsed.description;
	}

	// SKILL.md: `dependencies: [a, b]` (YAML array)
	if (Array.isArray(parsed.dependencies)) {
		result.dependencies = parsed.dependencies.filter((d): d is string => typeof d === "string");
	}

	// Agent .md: `skills: a, b` (comma-separated string) or `skills: [a, b]` (array)
	if (parsed.skills !== undefined) {
		result.skills = parseCommaSeparatedOrArray(parsed.skills);
	}

	return result;
}

/**
 * Parse a field that can be either a comma-separated string or a YAML array.
 * Handles: "a, b, c" or ["a", "b", "c"] or "a" (single value)
 */
function parseCommaSeparatedOrArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((d): d is string => typeof d === "string").map((s) => s.trim());
	}
	if (typeof value === "string") {
		return value
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
	}
	return [];
}

/**
 * Get all declared dependencies from frontmatter, regardless of format.
 * Merges `dependencies:` (skills) and `skills:` (agents) into one list.
 */
export function getDeclaredDeps(fm: SkillFrontmatter): string[] {
	const deps = new Set<string>();
	for (const d of fm.dependencies ?? []) deps.add(d);
	for (const d of fm.skills ?? []) deps.add(d);
	return [...deps];
}
