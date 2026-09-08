import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { describeScanFailure, parseEntityList, scanModel } from "../../src/core/llm.js";

describe("llmScanContent", () => {
	test("throws on missing ANTHROPIC_API_KEY", async () => {
		const saved = process.env.ANTHROPIC_API_KEY;
		// `process.env.X = undefined` coerces to the string "undefined" on
		// Linux Bun in CI, which is truthy and defeats the `if (!apiKey)`
		// guard. `delete` is unambiguous across runtimes.
		delete process.env.ANTHROPIC_API_KEY;

		try {
			const mod = await import("../../src/core/llm.js");

			// Bun's `mock.module()` is process-global and cannot be reliably
			// undone across files (no `mock.restore()` for modules in Bun 1.3).
			// `tests/commands/scan.test.ts` mocks `llmScanContent` for its own
			// purposes, and depending on parallel file-execution order the mock
			// can be in effect here. Inspect the function's source to detect
			// the mock — the real implementation contains the "ANTHROPIC_API_KEY"
			// literal in its guard clause; the mock does not.
			const isReal = mod.llmScanContent.toString().includes("ANTHROPIC_API_KEY");
			if (!isReal) return;

			await expect(
				mod.llmScanContent("test content", [{ name: "test", type: "skill" }]),
			).rejects.toThrow("ANTHROPIC_API_KEY");
		} finally {
			if (saved) process.env.ANTHROPIC_API_KEY = saved;
		}
	});
});

describe("parseEntityList", () => {
	test("extracts valid JSON array from text", () => {
		const result = parseEntityList(
			'Here are the results: [{"name": "python-coding", "type": "skill"}]',
		);
		expect(result).toEqual([{ name: "python-coding", type: "skill" }]);
	});

	test("extracts JSON from markdown code block", () => {
		const result = parseEntityList('```json\n[{"name": "testing", "type": "skill"}]\n```');
		expect(result).toEqual([{ name: "testing", type: "skill" }]);
	});

	test("returns empty for text with no JSON array", () => {
		const result = parseEntityList("No dependencies found.");
		expect(result).toEqual([]);
	});

	test("handles empty array", () => {
		const result = parseEntityList("[]");
		expect(result).toEqual([]);
	});

	test("filters objects without name/type string fields", () => {
		const result = parseEntityList(
			'[{"name": "valid", "type": "skill"}, {"foo": "bar"}, {"name": 123, "type": "skill"}]',
		);
		expect(result).toEqual([{ name: "valid", type: "skill" }]);
	});

	test("returns empty for invalid JSON", () => {
		const result = parseEntityList("[not valid json}");
		expect(result).toEqual([]);
	});

	test("returns empty for non-array JSON", () => {
		const result = parseEntityList('{"name": "not-array", "type": "skill"}');
		expect(result).toEqual([]);
	});

	test("handles multiple entities", () => {
		const result = parseEntityList(
			'[{"name": "a", "type": "skill"}, {"name": "b", "type": "agent"}]',
		);
		expect(result).toEqual([
			{ name: "a", type: "skill" },
			{ name: "b", type: "agent" },
		]);
	});
});

/**
 * Issue #181: the scan model was hardcoded at two call sites with no override.
 * The version being stale mattered less than the shape — nothing exercises the
 * SDK call (CI has no API key), so a dead model id would reach a user before it
 * reached us, and the only remedy was patching the source.
 */
describe("scanModel (#181)", () => {
	const ENV = "SKILLTREE_LLM_MODEL";

	function withEnv<T>(value: string | undefined, fn: () => T): T {
		const saved = process.env[ENV];
		// `delete` rather than assigning undefined: assigning coerces to the
		// string "undefined" on Linux Bun, which would look like an override.
		if (value === undefined) delete process.env[ENV];
		else process.env[ENV] = value;
		try {
			return fn();
		} finally {
			if (saved === undefined) delete process.env[ENV];
			else process.env[ENV] = saved;
		}
	}

	test("defaults to the current-generation Sonnet", () => {
		expect(withEnv(undefined, scanModel)).toBe("claude-sonnet-5");
	});

	test("an override wins", () => {
		expect(withEnv("claude-opus-5", scanModel)).toBe("claude-opus-5");
	});

	test("an override is trimmed", () => {
		expect(withEnv("  claude-haiku-4-5  ", scanModel)).toBe("claude-haiku-4-5");
	});

	for (const blank of ["", "   ", "\t"]) {
		test(`a blank override (${JSON.stringify(blank)}) falls back to the default`, () => {
			// A blank env var is an unset var that went through a shell, not a
			// deliberate model choice — and it would only earn a 400.
			expect(withEnv(blank, scanModel)).toBe("claude-sonnet-5");
		});
	}

	test("no model id is hardcoded at a call site", () => {
		// The two `messages.create` calls must read from one source. Two
		// literals can drift; that was half of #181.
		const source = readFileSync(join(__dirname, "..", "..", "src", "core", "llm.ts"), "utf-8");
		const literals = source.match(/"claude-[a-z0-9-]+"/g) ?? [];
		expect(literals.length).toBe(1);
	});
});

describe("describeScanFailure (#181)", () => {
	test("an API error names the model and the override", () => {
		const apiError = new Anthropic.APIError(404, { type: "error" }, "model not found", undefined);
		const described = describeScanFailure(apiError);

		// The error message is the mitigation: nothing else can tell a user that
		// their pinned model went away, since no test exercises the API call.
		expect(described.message).toContain("claude-sonnet-5");
		expect(described.message).toContain("SKILLTREE_LLM_MODEL");
		// The SDK error stays reachable for debugging.
		expect(described.cause).toBe(apiError);
	});

	test("the reported model reflects an active override", () => {
		const saved = process.env.SKILLTREE_LLM_MODEL;
		process.env.SKILLTREE_LLM_MODEL = "claude-opus-5";
		try {
			const apiError = new Anthropic.APIError(404, { type: "error" }, "nope", undefined);
			expect(describeScanFailure(apiError).message).toContain("claude-opus-5");
		} finally {
			if (saved === undefined) delete process.env.SKILLTREE_LLM_MODEL;
			else process.env.SKILLTREE_LLM_MODEL = saved;
		}
	});

	test("a non-API error passes through untouched", () => {
		// Don't bury an unrelated failure (a bad key, a network drop) under a
		// message about model ids.
		const original = new Error("something else broke");
		expect(describeScanFailure(original)).toBe(original);
	});

	test("a non-Error value still becomes an Error", () => {
		const described = describeScanFailure("just a string");
		expect(described).toBeInstanceOf(Error);
		expect(described.message).toContain("just a string");
	});
});
