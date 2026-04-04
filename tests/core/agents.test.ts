import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectInstalledAgents,
	getKnownAgentNames,
	pathToAgentName,
	resolveGlobalTarget,
	resolveTarget,
} from "../../src/core/agents.js";

describe("resolveTarget", () => {
	test('resolves "claude" to ".claude"', () => {
		expect(resolveTarget("claude")).toBe(".claude");
	});

	test('resolves "codex" to ".codex"', () => {
		expect(resolveTarget("codex")).toBe(".codex");
	});

	test("resolves all 6 known agents correctly", () => {
		expect(resolveTarget("claude")).toBe(".claude");
		expect(resolveTarget("codex")).toBe(".codex");
		expect(resolveTarget("cursor")).toBe(".cursor");
		expect(resolveTarget("copilot")).toBe(".copilot");
		expect(resolveTarget("gemini")).toBe(".gemini");
		expect(resolveTarget("windsurf")).toBe(".windsurf");
	});

	test('passes through "./custom" as literal path', () => {
		expect(resolveTarget("./custom")).toBe("./custom");
	});

	test('passes through "/abs/path" as literal path', () => {
		expect(resolveTarget("/abs/path")).toBe("/abs/path");
	});

	test('throws for unknown bare word "foo"', () => {
		expect(() => resolveTarget("foo")).toThrow("unknown agent");
	});

	test("error message includes suggestion to use ./foo", () => {
		expect(() => resolveTarget("foo")).toThrow("./foo");
	});
});

describe("resolveGlobalTarget", () => {
	const home = homedir();

	test('resolves "claude" to expanded ~/.claude', () => {
		expect(resolveGlobalTarget("claude")).toBe(join(home, ".claude"));
	});

	test('resolves "codex" to expanded ~/.codex', () => {
		expect(resolveGlobalTarget("codex")).toBe(join(home, ".codex"));
	});

	test("passes through literal paths unchanged", () => {
		expect(resolveGlobalTarget("/custom/path")).toBe("/custom/path");
		expect(resolveGlobalTarget("./relative")).toBe("./relative");
	});

	test("throws for unknown bare word", () => {
		expect(() => resolveGlobalTarget("foo")).toThrow("unknown agent");
	});
});

describe("pathToAgentName", () => {
	test('maps ".claude" back to "claude"', () => {
		expect(pathToAgentName(".claude")).toBe("claude");
	});

	test('maps ".codex" back to "codex"', () => {
		expect(pathToAgentName(".codex")).toBe("codex");
	});

	test('returns null for unknown path ".custom"', () => {
		expect(pathToAgentName(".custom")).toBeNull();
	});

	test("maps all 6 known agent dirs back to names", () => {
		expect(pathToAgentName(".claude")).toBe("claude");
		expect(pathToAgentName(".codex")).toBe("codex");
		expect(pathToAgentName(".cursor")).toBe("cursor");
		expect(pathToAgentName(".copilot")).toBe("copilot");
		expect(pathToAgentName(".gemini")).toBe("gemini");
		expect(pathToAgentName(".windsurf")).toBe("windsurf");
	});
});

describe("detectInstalledAgents", () => {
	let tempDir: string;

	afterEach(async () => {
		if (tempDir) await rm(tempDir, { recursive: true, force: true });
	});

	test("returns agent names for existing home directories", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-agents-"));

		// Create fake agent home directories
		await mkdir(join(tempDir, ".claude"));
		await mkdir(join(tempDir, ".codex"));

		const agents = await detectInstalledAgents(tempDir);
		expect(agents).toContain("claude");
		expect(agents).toContain("codex");
		expect(agents).not.toContain("cursor");
	});

	test("returns empty array when no agents installed", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-agents-"));

		const agents = await detectInstalledAgents(tempDir);
		expect(agents).toEqual([]);
	});

	test("only returns agents that actually exist on disk", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-agents-"));

		await mkdir(join(tempDir, ".gemini"));

		const agents = await detectInstalledAgents(tempDir);
		expect(agents).toEqual(["gemini"]);
	});
});

describe("getKnownAgentNames", () => {
	test("returns all 6 agent names", () => {
		const names = getKnownAgentNames();
		expect(names).toHaveLength(6);
		expect(names).toContain("claude");
		expect(names).toContain("codex");
		expect(names).toContain("cursor");
		expect(names).toContain("copilot");
		expect(names).toContain("gemini");
		expect(names).toContain("windsurf");
	});

	test("returns sorted array", () => {
		const names = getKnownAgentNames();
		const sorted = [...names].sort();
		expect(names).toEqual(sorted);
	});
});
