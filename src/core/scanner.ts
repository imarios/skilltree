import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import YAML from "yaml";
import type { SkillFrontmatter } from "../types.js";
import { entityNameFromPath, mdFileType } from "./entity-type.js";
import { getDeclaredDeps, parseFrontmatter } from "./frontmatter.js";
import { llmScanContent } from "./llm.js";

/**
 * Regex patterns for detecting entity references in body text.
 * Battle-tested patterns for skill prose plus slash-command syntax.
 */
const PATTERNS = [
	// **LOAD** `task-builder` skill
	/\*\*LOAD\*\*\s+`([a-z0-9][a-z0-9-]*)`\s+skill\b/gi,
	// Use the python-coding skill (but not "use the dedicated skills:")
	/[Uu]se\s+the\s+([a-z0-9][a-z0-9-]*)\s+skill\b/g,
	// Use `cy-language` skill
	/[Uu]se\s+`([a-z0-9][a-z0-9-]*)`\s+skill\b/g,
	// Load the python-coding skill / Load python-coding skill
	/[Ll]oad\s+(?:the\s+)?([a-z0-9][a-z0-9-]*)\s+skill\b/g,
	// Catch-all: "the X skill" / "a X skill" — covers Refer to, Follow, Check, Apply, etc.
	// Also handles optional delimiters: the `X` skill, the "X" skill, the 'X' skill, the <X> skill
	/(?:the|a)\s+[`'"<]?([a-z0-9][a-z0-9-]*)[`'">]?\s+skill\b/gi,
	// Standalone quoted/bracketed: `X` skill, "X" skill, 'X' skill, <X> skill (no article needed)
	/[`'"<]([a-z0-9][a-z0-9-]*)[`'">]\s+skill\b/gi,
	// Claude Code slash-command syntax: /<name>. Lookbehind blocks path segments
	// (path/to, https://...) by requiring the `/` to follow whitespace, line start,
	// or a quoting/bracketing character — not a word/identifier character or another
	// `/`. Lookahead `(?!/)` blocks multi-segment paths like /usr/local/share.
	/(?<![/\w])\/([a-z][a-z0-9-]+)\b(?!\/)/g,
	// XML-style Skill tag: <Skill name="foo"/>, <Skill name="foo"></Skill>,
	// <Skill name='foo'>, and attribute-order-tolerant forms like
	// <Skill type="skill" name="foo" version="1.0" />. Anchored on the literal
	// tag name `Skill` so unrelated tags with a `name=` attribute don't match.
	// Issue #34.
	/<Skill\s+[^>]*?\bname=["']([a-z0-9][a-z0-9-]*)["'][^>]*?>/gi,
	// Call-form invocation: Skill(name="foo") / Skill( name = 'foo' ).
	// Issue #34.
	/\bSkill\s*\(\s*name\s*=\s*["']([a-z0-9][a-z0-9-]*)["']\s*\)/g,
];

/**
 * Minimum name length for detected skills.
 */
const MIN_NAME_LENGTH = 2;

/**
 * Claude Code's built-in slash commands. They ship with the harness, are not
 * packaged as registry skills/commands, and cannot be declared in
 * `dependencies:` — so the regex scan must drop them from the "undeclared"
 * set rather than ask the author to declare them. Issue #43.
 *
 * Match is exact (no prefix matching), so registry commands like `loop-runner`
 * are still detected normally.
 */
export const BUILTIN_HARNESS_COMMANDS = new Set([
	// Scheduling & loops
	"loop",
	"schedule",
	// Code workflows
	"simplify",
	"review",
	"security-review",
	// Model / mode toggles
	"fast",
	"model",
	// Harness control
	"help",
	"clear",
	"config",
	"init",
	"compact",
	"resume",
	"upgrade",
	"exit",
	// Config UIs
	"agents",
	"mcp",
	"hooks",
	"permissions",
	// Diagnostics / account
	"ide",
	"cost",
	"release-notes",
	"login",
	"logout",
	"memory",
	"status",
	"bug",
	"doctor",
]);

/**
 * Common English words that appear before "skill" in prose but are not skill
 * names (e.g., "a companion skill", "the expected skill"). Matched only for
 * single-token captures — hyphenated names like "python-coding" are never
 * filtered since real skill IDs are conventionally hyphenated.
 */
const STOPWORDS = new Set([
	"appropriate",
	"best",
	"certain",
	"chosen",
	"companion",
	"complete",
	"correct",
	"critical",
	"dedicated",
	"different",
	"entire",
	"essential",
	"expected",
	"first",
	"following",
	"full",
	"general",
	"given",
	"important",
	"key",
	"last",
	"main",
	"multiple",
	"named",
	"necessary",
	"new",
	"next",
	"old",
	"optional",
	"other",
	"particular",
	"previous",
	"primary",
	"proper",
	"related",
	"relevant",
	"required",
	"right",
	"same",
	"selected",
	"similar",
	"single",
	"specific",
	"target",
	"useful",
	"various",
	"whole",
	"wrong",
]);

export interface ScanResult {
	file: string;
	name?: string;
	declared: string[];
	detected: string[];
	undeclared: string[];
	llmSuggestions?: string[];
	/** Undeclared deps found by both regex and LLM (high confidence). */
	confirmed?: string[];
}

/**
 * Caller-supplied options for a scan. `extraIgnores` is a project- and/or
 * user-scoped extension of `BUILTIN_HARNESS_COMMANDS` — typically loaded from
 * `skilltree.yml`'s `scan.ignore` field plus the global manifest. Exact-match
 * semantics carry over from the builtin set (issue #52).
 */
export interface ScanOptions {
	extraIgnores?: ReadonlySet<string>;
}

/**
 * Whether a regex-captured token survives the post-match filters and counts as
 * a real entity reference. Drops sub-minimum-length tokens, self-references,
 * single-word English stopwords ("companion skill"), Claude Code's built-in
 * slash commands (issue #43), and any caller-supplied extras (issue #52).
 * Hyphenated tokens bypass the stopword check since real skill IDs are
 * conventionally hyphenated.
 */
function isCandidateRef(
	depName: string,
	selfName: string,
	extraIgnores?: ReadonlySet<string>,
): boolean {
	if (depName.length < MIN_NAME_LENGTH) return false;
	if (depName === selfName) return false;
	if (!depName.includes("-") && STOPWORDS.has(depName.toLowerCase())) return false;
	if (BUILTIN_HARNESS_COMMANDS.has(depName)) return false;
	if (extraIgnores?.has(depName)) return false;
	return true;
}

/**
 * Scan a single SKILL.md, agent .md, or command .md file for undeclared
 * dependencies.
 */
export async function scanFile(filePath: string, opts?: ScanOptions): Promise<ScanResult | null> {
	const content = await readFile(filePath, "utf-8");
	const frontmatter = parseFrontmatter(content);

	// Skip files without frontmatter
	if (frontmatter === null) {
		return null;
	}

	const declared = getDeclaredDeps(frontmatter);
	// Self-reference filter wants the *entity name*. Skills usually carry
	// `name:` in frontmatter; agents and commands typically don't — their
	// name is the filename stem (or parent dir for `SKILL.md`). Falling back
	// to the path-derived name keeps self-refs from leaking into `undeclared`
	// for command files like `verify-documentation.md` that mention themselves.
	const name = frontmatter.name ?? entityNameFromPath(filePath);

	// Extract body (everything after frontmatter)
	const bodyStart = content.indexOf("---", content.indexOf("---") + 3);
	const body = bodyStart >= 0 ? content.slice(bodyStart + 3) : "";

	// Detect references via regex
	const detected = new Set<string>();
	for (const pattern of PATTERNS) {
		// Reset lastIndex for global patterns
		pattern.lastIndex = 0;
		for (;;) {
			const match = pattern.exec(body);
			if (match === null) break;
			const depName = match[1];
			if (depName && isCandidateRef(depName, name, opts?.extraIgnores)) {
				detected.add(depName);
			}
		}
	}

	// Find undeclared = detected but not in frontmatter
	const declaredSet = new Set(declared);
	const undeclared = [...detected].filter((d) => !declaredSet.has(d));

	return {
		file: filePath,
		name,
		declared,
		detected: [...detected],
		undeclared,
	};
}

/**
 * Scan a file with LLM-assisted detection.
 * Tracks agreement between regex and LLM for confidence scoring.
 */
export async function scanFileWithLlm(
	filePath: string,
	knownEntities: Array<{ name: string; type: string }>,
	opts?: ScanOptions,
): Promise<ScanResult | null> {
	const result = await scanFile(filePath, opts);
	if (!result) return null;

	const content = await readFile(filePath, "utf-8");
	const llmDeps = await llmScanContent(content, knownEntities, result.name);

	const declaredSet = new Set(result.declared);
	const undeclaredSet = new Set(result.undeclared);
	// Apply the same ignore set to LLM suggestions so the two stages agree
	// (issue #52). Without this, `--llm` could surface names that the regex
	// stage was told to skip — exactly the kind of disagreement the user
	// expects the config to silence.
	const extraIgnores = opts?.extraIgnores;
	const llmNames = llmDeps
		.map((d) => d.name)
		.filter((name) => !declaredSet.has(name) && !(extraIgnores?.has(name) ?? false));

	// Confirmed: found by both regex and LLM (high confidence)
	const confirmed = llmNames.filter((name) => undeclaredSet.has(name));

	// LLM-only: found by LLM but not regex
	const llmSuggestions = llmNames.filter((name) => !undeclaredSet.has(name));

	return {
		...result,
		llmSuggestions,
		confirmed,
	};
}

/**
 * Scan multiple files and return results.
 */
export async function scanFiles(filePaths: string[], opts?: ScanOptions): Promise<ScanResult[]> {
	const results: ScanResult[] = [];

	for (const filePath of filePaths) {
		const result = await scanFile(filePath, opts);
		if (result) {
			results.push(result);
		}
	}

	return results;
}

/**
 * The two frontmatter keys we'll ever write deps under. `dependencies:` is the
 * SKILL.md / command convention; `skills:` is the agent convention. Both are
 * read by `parseFrontmatter`; only one should ever be written for any given
 * file. Issue #68.
 */
type DepsKey = "dependencies" | "skills";

/**
 * Decide which frontmatter key `applyToFrontmatter` should merge into.
 *
 * Priority (issue #68):
 *   1. Existing non-empty `dependencies:` list → write there.
 *   2. Else existing non-empty `skills:` list → write there.
 *   3. Else fall back to the convention for the file type:
 *      - SKILL.md  → `dependencies:`
 *      - agent .md → `skills:`
 *      - command .md → `dependencies:` (no command-specific key today)
 *
 * The non-chosen key, when both happen to exist, is left untouched — the
 * reader (`getDeclaredDeps`) already unions both, so preserving the orthogonal
 * key keeps author intent. This is the writer-side counterpart to the
 * reader's tolerance.
 */
function chooseDepsKey(filePath: string, fm: SkillFrontmatter): DepsKey {
	if ((fm.dependencies ?? []).length > 0) return "dependencies";
	if ((fm.skills ?? []).length > 0) return "skills";
	if (basename(filePath) === "SKILL.md") return "dependencies";
	return mdFileType(filePath) === "agent" ? "skills" : "dependencies";
}

/**
 * Apply detected dependencies to frontmatter.
 *
 * Merges into whichever existing deps key the author chose (or the file-type
 * convention when neither is present) and writes exactly one deps block —
 * never a parallel `dependencies:`/`skills:` pair. See `chooseDepsKey` and
 * issue #68 for the full rules.
 *
 * Uses YAML.parseDocument so author formatting survives the round-trip:
 * flow-style sequences, comments, key ordering, scalar style are preserved
 * for everything we don't touch. Only the target deps key gets a new value;
 * the rest of the frontmatter passes through verbatim (#91).
 */
export async function applyToFrontmatter(filePath: string, newDeps: string[]): Promise<void> {
	const content = await readFile(filePath, "utf-8");
	const frontmatter = parseFrontmatter(content);

	if (!frontmatter) return;

	const targetKey = chooseDepsKey(filePath, frontmatter);
	const existing = frontmatter[targetKey] ?? [];
	const merged = [...new Set([...existing, ...newDeps])].sort();
	if (merged.length === 0) return;

	// Find frontmatter boundaries (parseFrontmatter already verified shape).
	const firstDelim = content.indexOf("---");
	const secondDelim = content.indexOf("---", firstDelim + 3);
	const fmYaml = content.slice(firstDelim + 3, secondDelim);
	const bodyAfter = content.slice(secondDelim + 3);

	const doc = YAML.parseDocument(fmYaml);
	// Mutate (or add) the target key in-place. yaml@2.x preserves untouched
	// nodes' style + comments through .toString(); the new sequence will use
	// the Document's default style (block), which matches the historical
	// behavior for the value we control.
	doc.set(targetKey, merged);

	// Trim the leading/trailing newlines that .toString() adds so the
	// `---\n<yaml>\n---` envelope stays canonical regardless of the input's
	// leading whitespace.
	const newFm = doc.toString().replace(/^\n+|\n+$/g, "");
	const newContent = `---\n${newFm}\n---${bodyAfter}`;

	await writeFile(filePath, newContent, "utf-8");
}
