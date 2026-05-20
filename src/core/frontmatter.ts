import semver from "semver";
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

// ---------------------------------------------------------------------------
// Frontmatter lint (issue #83)
// ---------------------------------------------------------------------------

/**
 * One issue produced by `validateFrontmatter`. `kind` drives presentation
 * AND the `--strict` exit-1 condition:
 *
 *   warning — printed via `warn(...)`, counts toward `--strict` exit 1.
 *             Examples: missing required field, type mismatch, invalid semver.
 *             Will become an outright error in v1.0 (see issue #83).
 *
 *   note    — printed dim, never gates `--strict`. Examples: unknown
 *             frontmatter key (so authors learn the supported shape).
 */
/**
 * Severity levels for frontmatter lint findings (#124):
 *   error   — file is structurally broken or has an invalid schema. Fails
 *             `check` by default (no `--strict` needed). Examples: malformed
 *             YAML in frontmatter, frontmatter that isn't a mapping, unknown
 *             frontmatter keys (`type: notathing`, `publish: "no"`).
 *   warning — soft issue that doesn't break the file. `--strict` promotes
 *             to exit 1. Examples: missing required field, missing
 *             frontmatter altogether, empty frontmatter.
 *   note    — informational; never gates.
 */
export interface FrontmatterIssue {
	kind: "error" | "warning" | "note";
	field?: string;
	message: string;
}

/**
 * Fields recognized in SKILL.md / agent .md / command .md frontmatter.
 * Anything else becomes a "unknown frontmatter key" note. The keys mirror
 * what `parseFrontmatter` actually reads (above) plus `version`, which the
 * linter validates but the runtime does not consume today.
 */
const KNOWN_FRONTMATTER_KEYS = new Set([
	"name",
	"description",
	"version",
	"dependencies",
	"skills",
]);

/**
 * Validate the YAML frontmatter of a SKILL.md / agent .md / command .md.
 *
 * Returns a flat list of issues — empty means the file is clean. The lint
 * is intentionally permissive: optional fields are validated only when
 * present, unknown keys are notes (not warnings), and the parser is shared
 * with `parseFrontmatter` semantics (e.g., `skills:` accepts either a
 * comma-separated string or a YAML array).
 *
 * The caller (currently `skilltree check`) is responsible for prefixing
 * messages with the file path and routing warnings vs notes to the right
 * output channel. Keeping the validator path-agnostic also makes it
 * straightforward to unit-test.
 *
 * Issue #83 / Authoring UX v1 (#78).
 */
export function validateFrontmatter(
	content: string,
	context: { entityName: string },
): FrontmatterIssue[] {
	const shell = extractFrontmatterYaml(content);
	if ("issue" in shell) return [shell.issue];

	const parsed = parseFrontmatterMapping(shell.yaml);
	if ("issue" in parsed) return [parsed.issue];

	const fm = parsed.mapping;
	return [
		...checkName(fm, context.entityName),
		...checkDescription(fm),
		...checkVersion(fm),
		...checkDependencies(fm),
		...checkSkills(fm),
		...collectUnknownKeyNotes(fm),
	];
}

/**
 * Locate the `---` … `---` block at the head of the file and return the
 * raw YAML content between them. Single-issue early returns isolate the
 * "structural" failures (missing/empty/malformed delimiters) so the
 * field-level checks can assume a parseable mapping.
 */
function extractFrontmatterYaml(content: string): { yaml: string } | { issue: FrontmatterIssue } {
	const trimmed = content.trimStart();
	if (!trimmed.startsWith("---")) {
		return { issue: { kind: "warning", message: "missing frontmatter" } };
	}
	const endIndex = trimmed.indexOf("---", 3);
	if (endIndex === -1) {
		// Structural break — the file's frontmatter is unparseable. Hard error
		// regardless of --strict (#124).
		return {
			issue: { kind: "error", message: "malformed frontmatter: missing closing ---" },
		};
	}
	const yaml = trimmed.slice(3, endIndex).trim();
	if (!yaml) return { issue: { kind: "warning", message: "empty frontmatter" } };
	return { yaml };
}

function parseFrontmatterMapping(
	yamlContent: string,
): { mapping: Record<string, unknown> } | { issue: FrontmatterIssue } {
	try {
		const raw = YAML.parse(yamlContent);
		if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
			return { issue: { kind: "error", message: "frontmatter must be a YAML mapping" } };
		}
		return { mapping: raw as Record<string, unknown> };
	} catch (e) {
		const detail = e instanceof Error ? e.message : String(e);
		return {
			// Unparseable YAML is a hard error — the file is broken, not a lint
			// nit. Always exit 1, no --strict required (#124).
			issue: { kind: "error", message: `malformed YAML in frontmatter: ${detail}` },
		};
	}
}

function warning(field: string, message: string): FrontmatterIssue {
	return { kind: "warning", field, message };
}

function checkName(fm: Record<string, unknown>, expectedName: string): FrontmatterIssue[] {
	if (fm.name === undefined) return [warning("name", "missing required field 'name'")];
	if (typeof fm.name !== "string") {
		return [warning("name", `'name' must be a string, got ${describeType(fm.name)}`)];
	}
	if (fm.name !== expectedName) {
		return [
			warning(
				"name",
				`'name' is "${fm.name}", expected "${expectedName}" (must match manifest key)`,
			),
		];
	}
	return [];
}

function checkDescription(fm: Record<string, unknown>): FrontmatterIssue[] {
	if (fm.description === undefined) {
		return [warning("description", "missing required field 'description'")];
	}
	if (typeof fm.description !== "string" || fm.description.trim() === "") {
		return [warning("description", "'description' must be a non-empty string")];
	}
	return [];
}

function checkVersion(fm: Record<string, unknown>): FrontmatterIssue[] {
	if (fm.version === undefined) return [];
	const ver = fm.version;
	if (typeof ver === "string" && semver.valid(ver)) return [];
	const display = typeof ver === "string" ? `'${ver}'` : describeType(ver);
	return [warning("version", `version ${display} is not valid semver`)];
}

function checkDependencies(fm: Record<string, unknown>): FrontmatterIssue[] {
	if (fm.dependencies === undefined) return [];
	if (!Array.isArray(fm.dependencies)) {
		return [
			warning(
				"dependencies",
				`'dependencies' must be an array of strings, got ${describeType(fm.dependencies)}`,
			),
		];
	}
	const badEntry = fm.dependencies.find((entry) => typeof entry !== "string");
	if (badEntry !== undefined) {
		return [
			warning(
				"dependencies",
				`'dependencies' entries must be strings, got ${describeType(badEntry)}`,
			),
		];
	}
	return [];
}

/**
 * `skills:` mirrors `parseCommaSeparatedOrArray` above — array of strings
 * OR a comma-separated string are both valid. Anything else is a warning.
 */
function checkSkills(fm: Record<string, unknown>): FrontmatterIssue[] {
	if (fm.skills === undefined) return [];
	const skills = fm.skills;
	if (typeof skills === "string") return [];
	if (!Array.isArray(skills)) {
		return [
			warning(
				"skills",
				`'skills' must be an array of strings or comma-separated string, got ${describeType(skills)}`,
			),
		];
	}
	const badEntry = skills.find((entry) => typeof entry !== "string");
	if (badEntry !== undefined) {
		return [warning("skills", `'skills' entries must be strings, got ${describeType(badEntry)}`)];
	}
	return [];
}

/**
 * Unknown keys — hard error (#124). The `install` path rejects unknown shape
 * fields like `type: notathing` or `publish: "no"`, and `check` must agree
 * to be useful as a pre-commit lint. Before #124 these were dim notes; the
 * "false ✔ No issues" output line then contradicted the per-file detail
 * lines printed right above it.
 */
function collectUnknownKeyNotes(fm: Record<string, unknown>): FrontmatterIssue[] {
	const errors: FrontmatterIssue[] = [];
	for (const key of Object.keys(fm)) {
		if (!KNOWN_FRONTMATTER_KEYS.has(key)) {
			errors.push({ kind: "error", field: key, message: `unknown frontmatter key '${key}'` });
		}
	}
	return errors;
}

function describeType(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}
