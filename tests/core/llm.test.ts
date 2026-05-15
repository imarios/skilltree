import { describe, expect, test } from "bun:test";
import { parseEntityList } from "../../src/core/llm.js";

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
