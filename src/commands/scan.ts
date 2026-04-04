import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ScanResult } from "../core/scanner.js";
import { applyToFrontmatter, scanFiles, scanFileWithLlm } from "../core/scanner.js";
import { dim, pc, success } from "../core/ui.js";

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

async function buildKnownEntities(files: string[]): Promise<Array<{ name: string; type: string }>> {
	const entities: Array<{ name: string; type: string }> = [];
	const results = await scanFiles(files);
	for (const result of results) {
		if (result.name) {
			entities.push({ name: result.name, type: "skill" });
		}
	}
	return entities;
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

	const results = options.llm ? await runLlmScan(allFiles) : await scanFiles(allFiles);

	if (options.json) {
		console.log(JSON.stringify(results, null, 2));
		return;
	}

	const hasGaps = await displayResults(results, options);

	if (options.check && hasGaps) {
		process.exit(1);
	}
}

async function runLlmScan(allFiles: string[]): Promise<ScanResult[]> {
	console.log(dim("Running LLM-assisted scan (this may take a moment)...\n"));
	const knownEntities = await buildKnownEntities(allFiles);
	const results: ScanResult[] = [];
	for (const file of allFiles) {
		const result = await scanFileWithLlm(file, knownEntities);
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
		success("All skill references are declared in frontmatter.");
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
	}
}

async function applyDetections(result: ScanResult): Promise<void> {
	const toApply = [...result.undeclared, ...(result.llmSuggestions ?? [])];
	if (toApply.length > 0) {
		await applyToFrontmatter(result.file, toApply);
		success(`Applied ${toApply.length} deps to frontmatter`);
	}
}
