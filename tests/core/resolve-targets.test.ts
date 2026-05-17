// Tests for `resolveTargets` — a non-throwing wrapper around `resolveTarget`
// that returns a `TargetResolution` per input entry. Doctor's D8 check
// consumes these to surface target-consistency issues without crashing on
// the first bad entry.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTargets } from "../../src/commands/targets.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("resolveTargets", () => {
	test("known agent bare word resolves to the agent dir", async () => {
		const out = await resolveTargets(["claude"]);
		expect(out).toEqual([{ target: "claude", ok: true, path: ".claude" }]);
	});

	test("unknown bare word returns ok: false with error message", async () => {
		const out = await resolveTargets(["nonsense-agent-name"]);
		expect(out.length).toBe(1);
		const r = out[0];
		expect(r?.ok).toBe(false);
		expect(r?.target).toBe("nonsense-agent-name");
		expect(r?.error).toMatch(/unknown|not.*registered/i);
	});

	test("existing literal path resolves to itself with ok: true", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-resolve-targets-"));
		const sub = join(tempDir, "existing");
		await mkdir(sub, { recursive: true });
		// Pass absolute path so resolveTargets can stat regardless of cwd.
		const out = await resolveTargets([sub]);
		expect(out.length).toBe(1);
		expect(out[0]?.ok).toBe(true);
		expect(out[0]?.target).toBe(sub);
		expect(out[0]?.path).toBe(sub);
	});

	test("missing literal path returns ok: false with 'does not exist'", async () => {
		// Use a path that definitively can't exist.
		const out = await resolveTargets(["/nonexistent-skilltree-doctor-test-path-xyz"]);
		expect(out.length).toBe(1);
		expect(out[0]?.ok).toBe(false);
		expect(out[0]?.error).toMatch(/does not exist|not found/i);
	});

	test("mixed list preserves input order with per-entry status", async () => {
		const out = await resolveTargets([
			"claude",
			"nonsense-agent-name",
			"/nonexistent-skilltree-doctor-test-path-xyz",
		]);
		expect(out.length).toBe(3);
		expect(out[0]?.target).toBe("claude");
		expect(out[0]?.ok).toBe(true);
		expect(out[1]?.target).toBe("nonsense-agent-name");
		expect(out[1]?.ok).toBe(false);
		expect(out[2]?.target).toBe("/nonexistent-skilltree-doctor-test-path-xyz");
		expect(out[2]?.ok).toBe(false);
	});

	test("empty list returns empty array", async () => {
		const out = await resolveTargets([]);
		expect(out).toEqual([]);
	});
});
