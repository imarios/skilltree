import { describe, expect, test } from "bun:test";
import {
	expandSources,
	parseManifest,
	serializeManifest,
	validateGlobalManifest,
	validateManifest,
} from "../../src/core/manifest.js";

// =============================================================================
// Group A: Parse `packs:` section
// =============================================================================

describe("parseManifest — packs: section", () => {
	test("A1.a — single remote member", () => {
		const yaml = `
packs:
  python-pack:
    - repo: github.com/acme/python-skills
      path: python-coding
      version: "^1.0.0"
`;
		const m = parseManifest(yaml);
		expect(m.packs?.["python-pack"]).toEqual([
			{ repo: "github.com/acme/python-skills", path: "python-coding", version: "^1.0.0" },
		]);
	});

	test("A1.b — multi-repo members", () => {
		const yaml = `
packs:
  python-pack:
    - repo: github.com/acme/python-skills
      path: python-coding
    - repo: github.com/other/skills
      path: fast-api
`;
		const m = parseManifest(yaml);
		expect(m.packs?.["python-pack"]).toHaveLength(2);
		expect((m.packs?.["python-pack"]?.[1] as { repo: string }).repo).toBe(
			"github.com/other/skills",
		);
	});

	test("A1.c — local member", () => {
		const yaml = `
packs:
  my-stack:
    - local: ./skills/foo
`;
		const m = parseManifest(yaml);
		expect(m.packs?.["my-stack"]).toEqual([{ local: "./skills/foo" }]);
	});

	test("A1.d — source member (preserved before expansion)", () => {
		const yaml = `
sources:
  acme: github.com/acme/skills
packs:
  python-pack:
    - source: acme
      path: python-coding
`;
		const m = parseManifest(yaml);
		expect(m.packs?.["python-pack"]?.[0]).toEqual({ source: "acme", path: "python-coding" });
	});

	test("A1.e — member with name alias", () => {
		const yaml = `
packs:
  python-pack:
    - repo: github.com/acme/skills
      path: foo
      name: renamed
`;
		const m = parseManifest(yaml);
		expect((m.packs?.["python-pack"]?.[0] as { name: string }).name).toBe("renamed");
	});

	test("A1.f — member with force_path", () => {
		const yaml = `
packs:
  python-pack:
    - repo: github.com/acme/skills
      path: foo
      force_path: true
`;
		const m = parseManifest(yaml);
		expect((m.packs?.["python-pack"]?.[0] as { force_path: boolean }).force_path).toBe(true);
	});

	test("A1.g — member with type: agent", () => {
		const yaml = `
packs:
  python-pack:
    - repo: github.com/acme/skills
      path: foo
      type: agent
`;
		const m = parseManifest(yaml);
		expect((m.packs?.["python-pack"]?.[0] as { type: string }).type).toBe("agent");
	});

	test("A1.h — multiple packs in one manifest", () => {
		const yaml = `
packs:
  python-pack:
    - {repo: a, path: foo}
  js-pack:
    - {repo: b, path: bar}
`;
		const m = parseManifest(yaml);
		expect(Object.keys(m.packs ?? {})).toEqual(["python-pack", "js-pack"]);
	});
});

describe("parseManifest — packs: rejections", () => {
	const cases: Array<{ name: string; yaml: string; needle: RegExp }> = [
		{
			name: "A2.a — packs: is a string",
			yaml: "packs: hello\n",
			needle: /packs.*must be a mapping/i,
		},
		{
			name: "A2.b — packs: is a list",
			yaml: "packs:\n  - foo\n  - bar\n",
			needle: /packs.*must be a mapping/i,
		},
		{
			name: "A2.c — pack value is a string",
			yaml: "packs:\n  python-pack: foo\n",
			needle: /python-pack.*must be a list/i,
		},
		{
			name: "A2.d — pack value is a mapping",
			yaml: "packs:\n  python-pack: {a: 1}\n",
			needle: /python-pack.*must be a list/i,
		},
		{
			name: "A2.e — empty member list",
			yaml: "packs:\n  python-pack: []\n",
			needle: /python-pack.*at least one member/i,
		},
		{
			name: "A2.f — member is a string",
			yaml: "packs:\n  python-pack:\n    - foo\n",
			needle: /python-pack\[0\].*must be a mapping/i,
		},
		{
			name: "A2.g — nested pack on member",
			yaml: "packs:\n  python-pack:\n    - pack: other\n",
			needle: /python-pack\[0\].*nested packs are not supported/i,
		},
	];

	for (const c of cases) {
		test(c.name, () => {
			expect(() => parseManifest(c.yaml)).toThrow(c.needle);
		});
	}
});

describe("parseManifest — packs: round-trip", () => {
	test("A3.a — single pack roundtrips", () => {
		const yaml = `
packs:
  python-pack:
    - repo: github.com/acme/skills
      path: python-coding
      version: "^1.0.0"
`;
		const m = parseManifest(yaml);
		const m2 = parseManifest(serializeManifest(m));
		expect(m2.packs).toEqual(m.packs);
	});

	test("A3.b — multi-pack roundtrips with stable key order", () => {
		const yaml = `
packs:
  python-pack:
    - repo: a
      path: foo
  js-pack:
    - repo: b
      path: bar
`;
		const m = parseManifest(yaml);
		const m2 = parseManifest(serializeManifest(m));
		expect(Object.keys(m2.packs ?? {})).toEqual(Object.keys(m.packs ?? {}));
		expect(m2.packs).toEqual(m.packs);
	});
});

// =============================================================================
// Group B: Parse PackDependency inside dependencies:
// =============================================================================

describe("parseManifest — PackDependency in dependencies:", () => {
	test("B1.a — local pack ref", () => {
		const yaml = `
dependencies:
  python-pack:
    pack: python-pack
`;
		const m = parseManifest(yaml);
		expect(m.dependencies?.["python-pack"]).toEqual({ pack: "python-pack" });
	});

	test("B1.b — remote pack ref with version", () => {
		const yaml = `
dependencies:
  python-pack:
    pack: python-pack
    repo: github.com/acme/skill-packs
    version: "^2.0.0"
`;
		const m = parseManifest(yaml);
		expect(m.dependencies?.["python-pack"]).toEqual({
			pack: "python-pack",
			repo: "github.com/acme/skill-packs",
			version: "^2.0.0",
		});
	});

	test("B1.c — source-aliased pack ref", () => {
		const yaml = `
sources:
  acme: github.com/acme/skill-packs
dependencies:
  python-pack:
    pack: python-pack
    source: acme
    version: "^2.0.0"
`;
		const m = parseManifest(yaml);
		expect(m.dependencies?.["python-pack"]).toEqual({
			pack: "python-pack",
			source: "acme",
			version: "^2.0.0",
		});
	});

	test("B1.d — pack ref in dev-dependencies", () => {
		const yaml = `
dev-dependencies:
  python-pack:
    pack: python-pack
    repo: a
`;
		const m = parseManifest(yaml);
		expect(m["dev-dependencies"]?.["python-pack"]).toEqual({
			pack: "python-pack",
			repo: "a",
		});
	});

	test("B1.e — pack ref renaming via yaml key", () => {
		const yaml = `
dependencies:
  my-stack:
    pack: python-pack
    repo: a
`;
		const m = parseManifest(yaml);
		expect(m.dependencies?.["my-stack"]).toEqual({ pack: "python-pack", repo: "a" });
	});
});

// =============================================================================
// Group C: expandSources for packs
// =============================================================================

describe("expandSources — packs", () => {
	test("C1 — source-aliased pack member rewritten to remote", () => {
		const m = parseManifest(`
sources:
  acme: github.com/acme/skills
packs:
  python-pack:
    - source: acme
      path: python-coding
`);
		const expanded = expandSources(m);
		expect(expanded.packs?.["python-pack"]?.[0]).toEqual({
			repo: "github.com/acme/skills",
			path: "python-coding",
		});
	});

	test("C2 — source-aliased top-level pack ref rewritten to remote", () => {
		const m = parseManifest(`
sources:
  acme: github.com/acme/skill-packs
dependencies:
  python-pack:
    pack: python-pack
    source: acme
    version: "^1.0.0"
`);
		const expanded = expandSources(m);
		expect(expanded.dependencies?.["python-pack"]).toEqual({
			pack: "python-pack",
			repo: "github.com/acme/skill-packs",
			version: "^1.0.0",
		});
	});

	test("C3.a — unknown source alias on pack member errors", () => {
		const m = parseManifest(`
packs:
  python-pack:
    - source: missing
      path: foo
`);
		expect(() => expandSources(m)).toThrow(/Unknown source alias "missing"/);
	});

	test("C3.b — unknown source alias on pack ref errors", () => {
		const m = parseManifest(`
dependencies:
  python-pack:
    pack: python-pack
    source: missing
`);
		expect(() => expandSources(m)).toThrow(/Unknown source alias "missing"/);
	});

	test("C4 — non-pack source expansion still works", () => {
		const m = parseManifest(`
sources:
  acme: github.com/acme/skills
dependencies:
  foo:
    source: acme
    path: foo
`);
		const expanded = expandSources(m);
		expect(expanded.dependencies?.foo).toEqual({
			repo: "github.com/acme/skills",
			path: "foo",
		});
	});
});

// =============================================================================
// Group D: validateManifest rules
// =============================================================================

describe("validateManifest — PackDependency shape rules", () => {
	const cases: Array<{ name: string; manifestYaml: string; needle: RegExp }> = [
		{
			name: "D1.a — both repo and source",
			manifestYaml: `
dependencies:
  python-pack:
    pack: python-pack
    repo: a
    source: b
`,
			needle: /python-pack.*repo.*source.*mutually exclusive/i,
		},
		{
			name: "D1.b — pack ref with path",
			manifestYaml: `
dependencies:
  python-pack:
    pack: python-pack
    repo: a
    path: foo
`,
			needle: /python-pack.*path.*not valid on pack references/i,
		},
		{
			name: "D1.c — pack ref with local",
			manifestYaml: `
dependencies:
  python-pack:
    pack: python-pack
    local: ./foo
`,
			needle: /python-pack.*local.*not valid on pack references/i,
		},
		{
			name: "D1.d — pack ref with type",
			manifestYaml: `
dependencies:
  python-pack:
    pack: python-pack
    repo: a
    type: agent
`,
			needle: /python-pack.*type.*not valid on pack references/i,
		},
		{
			name: "D1.e — pack ref with name",
			manifestYaml: `
dependencies:
  python-pack:
    pack: python-pack
    repo: a
    name: foo
`,
			needle: /python-pack.*name.*not valid on pack references/i,
		},
		{
			name: "D1.f — pack ref with force_path",
			manifestYaml: `
dependencies:
  python-pack:
    pack: python-pack
    repo: a
    force_path: true
`,
			needle: /python-pack.*force_path.*not valid on pack references/i,
		},
		{
			name: "D1.g — pack ref with version but no repo/source",
			manifestYaml: `
dependencies:
  python-pack:
    pack: python-pack
    version: "^1.0.0"
`,
			needle: /python-pack.*version.*requires.*repo/i,
		},
	];

	for (const c of cases) {
		test(c.name, () => {
			const m = parseManifest(c.manifestYaml);
			const errors = validateManifest(m);
			expect(errors.some((e) => c.needle.test(e))).toBe(true);
		});
	}
});

describe("validateManifest — pack member shape rules", () => {
	test("D2.a — member missing both repo and local", () => {
		const m = parseManifest(`
packs:
  python-pack:
    - path: foo
`);
		const errors = validateManifest(m);
		expect(errors.some((e) => /packs\.python-pack\[0\]/.test(e))).toBe(true);
	});

	test("D2.b — member with both repo and local", () => {
		const m = parseManifest(`
packs:
  python-pack:
    - repo: a
      local: ./foo
`);
		const errors = validateManifest(m);
		expect(errors.some((e) => /packs\.python-pack\[0\]/.test(e))).toBe(true);
	});

	test("D2.c — publish on non-local member", () => {
		const m = parseManifest(`
packs:
  python-pack:
    - repo: a
      path: foo
      publish: false
`);
		const errors = validateManifest(m);
		expect(errors.some((e) => /packs\.python-pack\[0\].*publish/.test(e))).toBe(true);
	});

	test("D2.d — exclude on non-local member", () => {
		const m = parseManifest(`
packs:
  python-pack:
    - repo: a
      path: foo
      exclude:
        - "*.log"
`);
		const errors = validateManifest(m);
		expect(errors.some((e) => /packs\.python-pack\[0\].*exclude/.test(e))).toBe(true);
	});
});

describe("validateManifest — name-collision rule", () => {
	test("D3.a — packs.X conflicts with non-pack dependencies.X", () => {
		const m = parseManifest(`
packs:
  my-stack:
    - repo: a
      path: foo
dependencies:
  my-stack:
    repo: b
    path: bar
`);
		const errors = validateManifest(m);
		expect(errors.some((e) => /my-stack/.test(e) && /packs:/.test(e) && /pack:/.test(e))).toBe(
			true,
		);
	});

	test("D3.b — packs.X with matching pack ref is fine", () => {
		const m = parseManifest(`
packs:
  my-stack:
    - repo: a
      path: foo
dependencies:
  my-stack:
    pack: my-stack
`);
		const errors = validateManifest(m);
		expect(errors).toEqual([]);
	});

	test("D4 — unreferenced pack is not a validation error", () => {
		const m = parseManifest(`
packs:
  unused:
    - repo: a
      path: foo
`);
		const errors = validateManifest(m);
		expect(errors).toEqual([]);
	});
});

// =============================================================================
// Group E: validateGlobalManifest
// =============================================================================

describe("validateGlobalManifest — packs", () => {
	test("E1 — global manifest may not define packs", () => {
		const m = parseManifest(`
packs:
  python-pack:
    - repo: a
      path: foo
`);
		const errors = validateGlobalManifest(m);
		expect(errors.some((e) => /Global manifest does not support.*packs/.test(e))).toBe(true);
	});

	test("E1.b — global manifest may reference remote packs", () => {
		const m = parseManifest(`
dependencies:
  python-pack:
    pack: python-pack
    repo: github.com/acme/skill-packs
    version: "^1.0.0"
`);
		const errors = validateGlobalManifest(m);
		expect(errors).toEqual([]);
	});
});
