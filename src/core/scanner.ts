import { readFile, writeFile } from "node:fs/promises";
import { getDeclaredDeps, parseFrontmatter } from "./frontmatter.js";
import { llmScanContent } from "./llm.js";

/**
 * Regex patterns for detecting skill references in body text.
 * Battle-tested patterns for detecting skill references.
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
];

/**
 * Minimum name length for detected skills.
 */
const MIN_NAME_LENGTH = 2;

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
 * Scan a single SKILL.md or agent .md file for undeclared dependencies.
 */
export async function scanFile(filePath: string): Promise<ScanResult | null> {
	const content = await readFile(filePath, "utf-8");
	const frontmatter = parseFrontmatter(content);

	// Skip files without frontmatter
	if (frontmatter === null) {
		return null;
	}

	const declared = getDeclaredDeps(frontmatter);
	const name = frontmatter.name;

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
				// Filter self-references
				if (depName !== name) {
					detected.add(depName);
				}
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
