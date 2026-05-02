import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectInstalledAgents,
	getAgentLabel,
	getKnownAgentNames,
	pathToAgentName,
	resolveGlobalTarget,
	resolveTarget,
} from "../../src/core/agents.js";

describe("resolveTarget", () => {
	test('resolves "claude" to ".claude"', () => {
		expect(resolveTarget("claude")).toBe(".claude");
	});

	test('resolves "codex" to ".agents"', () => {
		expect(resolveTarget("codex")).toBe(".agents");
	});

	test("resolves all 6 known agents correctly", () => {
		expect(resolveTarget("claude")).toBe(".claude");
		expect(resolveTarget("codex")).toBe(".agents");
		expect(resolveTarget("cursor")).toBe(".cursor");
		expect(resolveTarget("copilot")).toBe(".github");
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

	test('resolves "codex" to expanded ~/.agents', () => {
		expect(resolveGlobalTarget("codex")).toBe(join(home, ".agents"));
	});

	test('resolves "windsurf" to expanded ~/.codeium/windsurf', () => {
		expect(resolveGlobalTarget("windsurf")).toBe(join(home, ".codeium", "windsurf"));
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

	test('maps ".agents" back to "codex"', () => {
		expect(pathToAgentName(".agents")).toBe("codex");
	});

	test('returns null for unknown path ".custom"', () => {
		expect(pathToAgentName(".custom")).toBeNull();
	});

	test("maps all 6 known agent dirs back to names", () => {
		expect(pathToAgentName(".claude")).toBe("claude");
		expect(pathToAgentName(".agents")).toBe("codex");
		expect(pathToAgentName(".cursor")).toBe("cursor");
		expect(pathToAgentName(".github")).toBe("copilot");
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

		// Create fake agent home directories (detection uses detectDir, not dir)
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

	test("detects codex via .codex dir even though install dir is .agents", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-agents-"));

		await mkdir(join(tempDir, ".codex"));

		const agents = await detectInstalledAgents(tempDir);
		expect(agents).toContain("codex");
	});

	test("detects copilot via .copilot dir even though install dir is .github", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-agents-"));

		await mkdir(join(tempDir, ".copilot"));

		const agents = await detectInstalledAgents(tempDir);
		expect(agents).toContain("copilot");
	});
});

describe("getAgentLabel", () => {
	test("returns friendly label for each known agent", () => {
		expect(getAgentLabel("claude")).toBe("Claude Code");
		expect(getAgentLabel("codex")).toBe("Codex");
		expect(getAgentLabel("copilot")).toBe("GitHub Copilot");
		expect(getAgentLabel("cursor")).toBe("Cursor");
		expect(getAgentLabel("gemini")).toBe("Gemini CLI");
		expect(getAgentLabel("windsurf")).toBe("Windsurf");
	});

	test("returns null for literal paths", () => {
		expect(getAgentLabel("./custom")).toBeNull();
		expect(getAgentLabel("/abs/path")).toBeNull();
		expect(getAgentLabel("~/somewhere")).toBeNull();
	});

	test("returns null for unknown bare words", () => {
		expect(getAgentLabel("foo")).toBeNull();
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
