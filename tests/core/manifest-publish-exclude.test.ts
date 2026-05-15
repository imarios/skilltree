import { describe, expect, test } from "bun:test";
import { parseManifest, serializeManifest, validateManifest } from "../../src/core/manifest.js";

// PS3, PS6: publish?: boolean and exclude?: string[] on local entries.
// PS4, PS7, PS27: reject on remote (repo:/source:) entries.
// PS28: type-check both fields.

describe("publish + exclude round-trip", () => {
	test("parses publish: false on a local entry", () => {
		const m = parseManifest(`
dependencies:
  wip:
    local: ./skills/wip
    type: skill
    publish: false
`);
		const dep = m.dependencies?.wip as unknown as Record<string, unknown>;
		expect(dep.publish).toBe(false);
	});

	test("parses exclude on a local entry", () => {
		const m = parseManifest(`
dependencies:
  x:
    local: ./skills/x
    type: skill
    exclude:
      - "experiments/"
      - "*.scratch.md"
`);
		const dep = m.dependencies?.x as unknown as Record<string, unknown>;
		expect(dep.exclude).toEqual(["experiments/", "*.scratch.md"]);
	});

	test("serializes publish: false", () => {
		const m = parseManifest(`
dependencies:
  wip:
    local: ./skills/wip
    publish: false
`);
		const s = serializeManifest(m);
		expect(s).toContain("publish: false");
	});

	test("serializes exclude", () => {
		const m = parseManifest(`
dependencies:
  x:
    local: ./skills/x
    exclude:
      - "experiments/"
`);
		const s = serializeManifest(m);
		expect(s).toContain("exclude:");
		expect(s).toContain("experiments/");
	});

	test("round-trip (parse → serialize → parse) preserves both fields", () => {
		const original = `
dependencies:
  x:
    local: ./skills/x
    publish: false
    exclude:
      - "experiments/"
      - "ab-results/"
`;
		const m1 = parseManifest(original);
		const s = serializeManifest(m1);
		const m2 = parseManifest(s);
		const d2 = m2.dependencies?.x as unknown as Record<string, unknown>;
		expect(d2.publish).toBe(false);
		expect(d2.exclude).toEqual(["experiments/", "ab-results/"]);
	});
});

describe("validateManifest — publish/exclude on remote entries", () => {
	test("rejects publish on repo: entry", () => {
		const m = parseManifest(`
dependencies:
  bad:
    repo: github.com/x/y
    path: skills/bad
    publish: false
`);
		const errs = validateManifest(m);
		expect(errs.some((e) => /publish/i.test(e) && /local/i.test(e))).toBe(true);
	});

	test("rejects publish on source: entry", () => {
		const m = parseManifest(`
sources:
  v: github.com/x/y
dependencies:
  bad:
    source: v
    path: skills/bad
    publish: true
`);
		const errs = validateManifest(m);
		expect(errs.some((e) => /publish/i.test(e) && /local/i.test(e))).toBe(true);
	});

	test("rejects exclude on repo: entry", () => {
		const m = parseManifest(`
dependencies:
  bad:
    repo: github.com/x/y
    path: skills/bad
    exclude:
      - "experiments/"
`);
		const errs = validateManifest(m);
		expect(errs.some((e) => /exclude/i.test(e) && /local/i.test(e))).toBe(true);
	});

	test("rejects exclude on source: entry", () => {
		const m = parseManifest(`
sources:
  v: github.com/x/y
dependencies:
  bad:
    source: v
    path: skills/bad
    exclude: ["x"]
`);
		const errs = validateManifest(m);
		expect(errs.some((e) => /exclude/i.test(e) && /local/i.test(e))).toBe(true);
	});
});

describe("validateManifest — type errors", () => {
	test("publish must be boolean (string rejected)", () => {
		const m = parseManifest(`
dependencies:
  x:
    local: ./skills/x
    publish: "false"
`);
		const errs = validateManifest(m);
		expect(errs.some((e) => /publish/i.test(e) && /boolean/i.test(e))).toBe(true);
	});

	test("publish must be boolean (number rejected)", () => {
		const m = parseManifest(`
dependencies:
  x:
    local: ./skills/x
    publish: 1
`);
		const errs = validateManifest(m);
		expect(errs.some((e) => /publish/i.test(e) && /boolean/i.test(e))).toBe(true);
	});

	test("exclude must be a list (string rejected)", () => {
		const m = parseManifest(`
dependencies:
  x:
    local: ./skills/x
    exclude: "experiments/"
`);
		const errs = validateManifest(m);
		expect(errs.some((e) => /exclude/i.test(e) && /list|array/i.test(e))).toBe(true);
	});

	test("exclude entries must be strings", () => {
		const m = parseManifest(`
dependencies:
  x:
    local: ./skills/x
    exclude:
      - 1
      - "ok"
`);
		const errs = validateManifest(m);
		expect(errs.some((e) => /exclude/i.test(e) && /string/i.test(e))).toBe(true);
	});
});

describe("validateManifest — positive cases", () => {
	test("publish: false on local entry → no error", () => {
		const m = parseManifest(`
dependencies:
  x:
    local: ./skills/x
    publish: false
`);
		expect(validateManifest(m)).toEqual([]);
	});

	test("publish: true on local entry → no error", () => {
		const m = parseManifest(`
dependencies:
  x:
    local: ./skills/x
    publish: true
`);
		expect(validateManifest(m)).toEqual([]);
	});

	test("exclude: [] on local entry → no error", () => {
		const m = parseManifest(`
dependencies:
  x:
    local: ./skills/x
    exclude: []
`);
		expect(validateManifest(m)).toEqual([]);
	});

	test("both publish and exclude on local entry → no error", () => {
		const m = parseManifest(`
dependencies:
  x:
    local: ./skills/x
    publish: false
    exclude:
      - "experiments/"
      - "*.scratch.md"
`);
		expect(validateManifest(m)).toEqual([]);
	});

	test("publish: false in dev-dependencies on local entry → no error (allowed, just redundant)", () => {
		const m = parseManifest(`
dev-dependencies:
  x:
    local: ./skills/x
    publish: false
`);
		expect(validateManifest(m)).toEqual([]);
	});
});
