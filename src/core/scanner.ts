import { readFile, writeFile } from "node:fs/promises";
import { entityNameFromPath } from "./entity-type.js";
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
];

/**
 * Minimum name length for detected skills.
 */
const MIN_NAME_LENGTH = 2;

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
 * Scan a single SKILL.md, agent .md, or command .md file for undeclared
 * dependencies.
 */
export async function scanFile(filePath: string): Promise<ScanResult | null> {
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
			if (depName && depName.length >= MIN_NAME_LENGTH) {
				// Filter self-references and common English stopwords (false positives
				// like "a companion skill"). Hyphenated names bypass the stopword check.
				if (depName === name) continue;
				if (!depName.includes("-") && STOPWORDS.has(depName.toLowerCase())) continue;
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
): Promise<ScanResult | null> {
	const result = await scanFile(filePath);
	if (!result) return null;

	const content = await readFile(filePath, "utf-8");
	const llmDeps = await llmScanContent(content, knownEntities, result.name);

	const declaredSet = new Set(result.declared);
	const undeclaredSet = new Set(result.undeclared);
	const llmNames = llmDeps.map((d) => d.name).filter((name) => !declaredSet.has(name));

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
export async function scanFiles(filePaths: string[]): Promise<ScanResult[]> {
	const results: ScanResult[] = [];

	for (const filePath of filePaths) {
		const result = await scanFile(filePath);
		if (result) {
			results.push(result);
		}
	}

	return results;
}

/**
 * Apply detected dependencies to frontmatter.
 * Adds undeclared deps to the dependencies list.
 */
export async function applyToFrontmatter(filePath: string, newDeps: string[]): Promise<void> {
	const content = await readFile(filePath, "utf-8");
	const frontmatter = parseFrontmatter(content);

	if (!frontmatter) return;

	const existing = frontmatter.dependencies ?? [];
	const merged = [...new Set([...existing, ...newDeps])].sort();

	// Rebuild frontmatter
	const depsYaml =
		merged.length > 0 ? `dependencies:\n${merged.map((d) => `  - ${d}`).join("\n")}` : "";

	// Find frontmatter boundaries
	const firstDelim = content.indexOf("---");
	const secondDelim = content.indexOf("---", firstDelim + 3);
	const existingFm = content.slice(firstDelim + 3, secondDelim).trim();

	// Remove existing dependencies block from frontmatter
	const fmLines = existingFm.split("\n");
	const filteredLines: string[] = [];
	let inDepBlock = false;
	for (const line of fmLines) {
		if (line.startsWith("dependencies:")) {
			inDepBlock = true;
			continue;
		}
		if (inDepBlock && line.startsWith("  - ")) {
			continue;
		}
		inDepBlock = false;
		filteredLines.push(line);
	}

	const newFmContent = [...filteredLines.filter((l) => l.trim()), depsYaml]
		.filter((l) => l)
		.join("\n");
	const bodyAfter = content.slice(secondDelim + 3);
	const newContent = `---\n${newFmContent}\n---${bodyAfter}`;

	await writeFile(filePath, newContent, "utf-8");
}
