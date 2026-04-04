import { describe, expect, test } from "bun:test";
import { parseEntityList } from "../../src/core/llm.js";

describe("llmScanContent", () => {
	test("throws on missing ANTHROPIC_API_KEY", async () => {
		const saved = process.env.ANTHROPIC_API_KEY;
		process.env.ANTHROPIC_API_KEY = undefined;

		// Dynamic import to get fresh module state
		const mod = await import("../../src/core/llm.js");

		await expect(
			mod.llmScanContent("test content", [{ name: "test", type: "skill" }]),
		).rejects.toThrow("ANTHROPIC_API_KEY");

		if (saved) process.env.ANTHROPIC_API_KEY = saved;
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
