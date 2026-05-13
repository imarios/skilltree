import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { entityNameFromPath, mdFileType } from "../core/entity-type.js";
import { readGlobalManifest, readManifest } from "../core/manifest.js";
import type { ScanResult } from "../core/scanner.js";
import { applyToFrontmatter, scanFiles, scanFileWithLlm } from "../core/scanner.js";
import { dim, pc, success } from "../core/ui.js";
import type { EntityType } from "../types.js";

export interface ScanOptions {
	check?: boolean;
	apply?: boolean;
	llm?: boolean;
	json?: boolean;
}

async function collectMdFiles(path: string): Promise<string[]> {
	const stats = await stat(path);
	if (stats.isFile()) {
		return path.endsWith(".md") ? [path] : [];
	}

	const files: string[] = [];
	const entries = await readdir(path, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(path, entry.name);
		if (entry.isDirectory()) {
			const subFiles = await collectMdFiles(fullPath);
			files.push(...subFiles);
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			files.push(fullPath);
		}
	}
	return files;
}

/**
 * Classify a `.md` path into an entity descriptor for the LLM scanner's
 * known-entity list. SKILL.md → skill; `.md` under any `commands/` segment
 * → command; everything else → agent. Frontmatter `name:` wins; otherwise
 * the name is derived from the path (parent dir for SKILL.md, filename
 * stem otherwise). Returns null only for the degenerate empty-name case
 * (e.g., a literal `.md` file with no frontmatter name).
 */
export function classifyEntityFile(
	filePath: string,
	frontmatterName?: string,
): { name: string; type: EntityType } | null {
	const name = frontmatterName ?? entityNameFromPath(filePath);
	if (!name) return null;
	const type: EntityType = basename(filePath) === "SKILL.md" ? "skill" : mdFileType(filePath);
	return { name, type };
}

async function buildKnownEntities(
	files: string[],
	extraIgnores: ReadonlySet<string>,
): Promise<Array<{ name: string; type: EntityType }>> {
	const results = await scanFiles(files, { extraIgnores });
	const entities: Array<{ name: string; type: EntityType }> = [];
	for (const result of results) {
		const classified = classifyEntityFile(result.file, result.name);
		if (classified) entities.push(classified);
	}
	return entities;
}

/**
 * Collect names the scanner should treat as already-known, beyond the
 * hardcoded `BUILTIN_HARNESS_COMMANDS` set. Unions the project manifest's
 * `scan.ignore` with the global manifest's, ignoring missing manifests
 * silently — both are optional configs. Issue #52.
 */
async function loadExtraIgnores(): Promise<Set<string>> {
	const ignores = new Set<string>();

	try {
		const project = await readManifest(process.cwd());
		for (const name of project.scan?.ignore ?? []) ignores.add(name);
	} catch {
		// No project manifest is fine — scan works without one.
	}

	try {
		const global = await readGlobalManifest();
		for (const name of global.scan?.ignore ?? []) ignores.add(name);
	} catch {
		// No global manifest is fine — global config is opt-in.
	}

	return ignores;
}

export async function scanCommand(paths: string[], options: ScanOptions): Promise<void> {
	const allFiles: string[] = [];
	for (const p of paths) {
		const files = await collectMdFiles(p);
		allFiles.push(...files);
	}

	if (allFiles.length === 0) {
		console.log("No .md files found.");
		return;
	}

	const extraIgnores = await loadExtraIgnores();
	const results = options.llm
		? await runLlmScan(allFiles, extraIgnores)
		: await scanFiles(allFiles, { extraIgnores });

	if (options.json) {
		console.log(JSON.stringify(results, null, 2));
		return;
	}

	const hasGaps = await displayResults(results, options);

	if (options.check && hasGaps) {
		process.exit(1);
	}
}

async function runLlmScan(
	allFiles: string[],
	extraIgnores: ReadonlySet<string>,
): Promise<ScanResult[]> {
	console.log(dim("Running LLM-assisted scan (this may take a moment)...\n"));
	const knownEntities = await buildKnownEntities(allFiles, extraIgnores);
	const results: ScanResult[] = [];
	for (const file of allFiles) {
		const result = await scanFileWithLlm(file, knownEntities, { extraIgnores });
		if (result) results.push(result);
	}
	return results;
}

async function displayResults(results: ScanResult[], options: ScanOptions): Promise<boolean> {
	let hasGaps = false;

	for (const result of results) {
		const hasUndeclared = result.undeclared.length > 0;
		const hasLlmSuggestions = (result.llmSuggestions?.length ?? 0) > 0;
		const hasConfirmed = (result.confirmed?.length ?? 0) > 0;

		if (!hasUndeclared && !hasLlmSuggestions && !hasConfirmed) continue;

		hasGaps = hasGaps || hasUndeclared || hasLlmSuggestions;
		console.log(`\n${pc.bold(result.file)}:`);
		console.log(`  Declared: ${result.declared.join(", ") || dim("(none)")}`);

		displayDetections(result);

		if (options.apply) {
			await applyDetections(result);
		}
	}

	if (!hasGaps && !results.some((r) => (r.confirmed?.length ?? 0) > 0)) {
		success("All entity references are declared in frontmatter.");
	}

	return hasGaps;
}

function displayDetections(result: ScanResult): void {
	if (result.confirmed?.length) {
		const confirmedSet = new Set(result.confirmed);
		const regexOnly = result.undeclared.filter((d) => !confirmedSet.has(d));

		for (const dep of result.confirmed) {
			console.log(`  ${pc.green("+")} ${pc.cyan(dep)}  ${pc.green("[regex+llm] high confidence")}`);
		}
		for (const dep of regexOnly) {
			console.log(`  ${pc.green("+")} ${pc.cyan(dep)}  ${dim("[regex]")}`);
		}
		for (const dep of result.llmSuggestions ?? []) {
			console.log(`  ${pc.green("+")} ${pc.cyan(dep)}  ${dim("[llm]")}`);
		}
	} else if (result.undeclared.length > 0) {
		console.log(`  Undeclared: ${pc.yellow(result.undeclared.join(", "))}`);
	} else if (result.llmSuggestions?.length) {
		for (const dep of result.llmSuggestions) {
			console.log(`  ${pc.green("+")} ${pc.cyan(dep)}  ${dim("[llm]")}`);
		}
	}
}

async function applyDetections(result: ScanResult): Promise<void> {
	const toApply = [...result.undeclared, ...(result.llmSuggestions ?? [])];
	if (toApply.length > 0) {
		await applyToFrontmatter(result.file, toApply);
		success(`Applied ${toApply.length} deps to frontmatter`);
	}
}
