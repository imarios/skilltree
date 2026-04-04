#!/usr/bin/env bun
/**
 * Scan eval runner.
 *
 * Runs skilltree scan (regex and optionally LLM) against test skills
 * and validates results against expectations.yaml.
 *
 * Usage:
 *   bun evals/scan/run-eval.ts              # regex only
 *   bun evals/scan/run-eval.ts --llm        # regex + LLM (requires ANTHROPIC_API_KEY)
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { scanFile, scanFileWithLlm } from "../../src/core/scanner.js";

const EVAL_DIR = dirname(new URL(import.meta.url).pathname);
const SKILLS_DIR = join(EVAL_DIR, "skills");
const EXPECTATIONS_PATH = join(EVAL_DIR, "expectations.yaml");

interface Expectation {
	declared: string[];
	regex: {
		must_detect: string[];
		must_not_detect: string[];
	};
	llm: {
		must_detect: string[];
		must_not_detect: string[];
	};
}

interface EvalResult {
	skill: string;
	mode: "regex" | "llm";
	passed: boolean;
	missing: string[]; // expected but not detected
	falsePositives: string[]; // detected but should not have been
}

async function loadExpectations(): Promise<Record<string, Expectation>> {
	const content = await readFile(EXPECTATIONS_PATH, "utf-8");
	return YAML.parse(content) as Record<string, Expectation>;
}

function buildKnownEntities(expectations: Record<string, Expectation>): Array<{ name: string; type: string }> {
	// Collect all skill names mentioned anywhere in expectations
	const names = new Set<string>();
	for (const [skill, exp] of Object.entries(expectations)) {
		names.add(skill);
		for (const d of exp.declared) names.add(d);
		for (const d of exp.regex.must_detect) names.add(d);
		for (const d of exp.regex.must_not_detect) names.add(d);
		for (const d of exp.llm.must_detect) names.add(d);
		for (const d of exp.llm.must_not_detect) names.add(d);
	}
	return [...names].map((name) => ({ name, type: "skill" }));
}

function evaluate(
	skill: string,
	mode: "regex" | "llm",
	detected: string[],
	must_detect: string[],
	must_not_detect: string[],
): EvalResult {
	const detectedSet = new Set(detected);
	const missing = must_detect.filter((d) => !detectedSet.has(d));
	const falsePositives = must_not_detect.filter((d) => detectedSet.has(d));
	return {
		skill,
		mode,
		passed: missing.length === 0 && falsePositives.length === 0,
		missing,
		falsePositives,
	};
}

async function main() {
	const runLlm = process.argv.includes("--llm");

	if (runLlm && !process.env.ANTHROPIC_API_KEY) {
		console.error("Error: ANTHROPIC_API_KEY required for --llm mode");
		process.exit(1);
	}

	const expectations = await loadExpectations();
	const knownEntities = buildKnownEntities(expectations);
	const results: EvalResult[] = [];
	const skillNames = Object.keys(expectations);

	console.log(`\nScan Eval — ${skillNames.length} skills, mode: ${runLlm ? "regex+llm" : "regex"}\n`);
	console.log("=".repeat(70));

	for (const skill of skillNames) {
		const exp = expectations[skill] as Expectation;
		const skillPath = join(SKILLS_DIR, skill, "SKILL.md");

		// Regex eval
		const regexResult = await scanFile(skillPath);
		if (!regexResult) {
			console.log(`\n  SKIP  ${skill} — no frontmatter`);
			continue;
		}

		const regexUndeclared = regexResult.undeclared;
		const regexEval = evaluate(skill, "regex", regexUndeclared, exp.regex.must_detect, exp.regex.must_not_detect);
		results.push(regexEval);

		console.log(`\n  ${regexEval.passed ? "PASS" : "FAIL"}  ${skill} [regex]`);
		if (regexUndeclared.length > 0) {
			console.log(`        detected: ${regexUndeclared.join(", ")}`);
		}
		if (!regexEval.passed) {
			if (regexEval.missing.length > 0) console.log(`        missing: ${regexEval.missing.join(", ")}`);
			if (regexEval.falsePositives.length > 0) console.log(`        false+: ${regexEval.falsePositives.join(", ")}`);
		}

		// LLM eval
		if (runLlm) {
			const llmResult = await scanFileWithLlm(skillPath, knownEntities);
			if (!llmResult) continue;

			// LLM-only detections: confirmed (both agree) + llm-only suggestions
			// Score LLM on what IT found, not what regex found
			const llmDetected = [
				...(llmResult.confirmed ?? []),
				...(llmResult.llmSuggestions ?? []),
			];

			const llmEval = evaluate(skill, "llm", llmDetected, exp.llm.must_detect, exp.llm.must_not_detect);
			results.push(llmEval);

			console.log(`  ${llmEval.passed ? "PASS" : "FAIL"}  ${skill} [llm]`);
			if (llmDetected.length > 0) {
				console.log(`        llm detected: ${llmDetected.join(", ")}`);
			}
			if (llmResult.confirmed && llmResult.confirmed.length > 0) {
				console.log(`        confirmed (regex+llm): ${llmResult.confirmed.join(", ")}`);
			}
			if (!llmEval.passed) {
				if (llmEval.missing.length > 0) console.log(`        missing: ${llmEval.missing.join(", ")}`);
				if (llmEval.falsePositives.length > 0) console.log(`        false+: ${llmEval.falsePositives.join(", ")}`);
			}
		}
	}

	// Summary
	console.log("\n" + "=".repeat(70));
	const passed = results.filter((r) => r.passed).length;
	const failed = results.filter((r) => !r.passed).length;
	const total = results.length;

	console.log(`\n  ${passed}/${total} passed, ${failed} failed`);

	if (failed > 0) {
		console.log("\n  Failures:");
		for (const r of results.filter((r) => !r.passed)) {
			const issues = [];
			if (r.missing.length > 0) issues.push(`missing: ${r.missing.join(", ")}`);
			if (r.falsePositives.length > 0) issues.push(`false+: ${r.falsePositives.join(", ")}`);
			console.log(`    ${r.skill} [${r.mode}]: ${issues.join("; ")}`);
		}
	}

	console.log();
	process.exit(failed > 0 ? 1 : 0);
}

main();
