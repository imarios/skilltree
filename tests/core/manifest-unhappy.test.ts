import { describe, expect, test } from "bun:test";
import { validateGlobalManifest, validateManifest } from "../../src/core/manifest.js";
import type { Dependency, Manifest } from "../../src/types.js";

describe("global manifest validation", () => {
	test("rejects dev-dependencies", () => {
		const manifest: Manifest = {
			dependencies: {},
			"dev-dependencies": {
				"my-skill": { local: "./skills/my-skill" },
			},
		};
		const errors = validateGlobalManifest(manifest);
		expect(errors.some((e) => e.includes("dev-dependencies"))).toBe(true);
	});

	test("rejects src_install_path", () => {
		const manifest: Manifest = {
			dependencies: {},
			src_install_path: "src/skills",
		};
		const errors = validateGlobalManifest(manifest);
		expect(errors.some((e) => e.includes("src_install_path"))).toBe(true);
	});

	test("rejects vendor mode", () => {
		const manifest: Manifest = {
			dependencies: {},
			vendor: true,
		};
		const errors = validateGlobalManifest(manifest);
		expect(errors.some((e) => e.includes("vendor"))).toBe(true);
	});

	test("accepts valid global manifest", () => {
		const manifest: Manifest = {
			dependencies: {
				"my-skill": { local: "~/Projects/skills/my-skill" },
			},
		};
		const errors = validateGlobalManifest(manifest);
		expect(errors).toEqual([]);
	});
});

describe("manifest duplicate key between groups", () => {
	test("rejects same key in dependencies and dev-dependencies", () => {
		const manifest: Manifest = {
			dependencies: {
				"shared-skill": { local: "./skills/shared" },
			},
			"dev-dependencies": {
				"shared-skill": { local: "./skills/shared-dev" },
			},
		};
		const errors = validateManifest(manifest);
		expect(errors.some((e) => e.includes("both dependencies and dev-dependencies"))).toBe(true);
	});
});

describe("manifest missing fields", () => {
	test("rejects dep with no repo/source/local", () => {
		const manifest: Manifest = {
			dependencies: {
				"bad-dep": { path: "skills/bad" } as unknown as Dependency,
			},
		};
		const errors = validateManifest(manifest);
		expect(errors.some((e) => e.includes('must have either "repo"/"source" or "local"'))).toBe(
			true,
		);
	});

	test("rejects dep with both repo and local", () => {
		const manifest: Manifest = {
			dependencies: {
				"bad-dep": {
					repo: "github.com/x/y",
					local: "./skills/bad",
					path: "skills/x",
				} as unknown as Dependency,
			},
		};
		const errors = validateManifest(manifest);
		expect(errors.some((e) => e.includes("mutually exclusive"))).toBe(true);
	});

	test("accepts remote dep without path (R12 — resolver infers it later)", () => {
		const manifest: Manifest = {
			dependencies: {
				"no-path": { repo: "github.com/x/y" } as unknown as Dependency,
			},
		};
		const errors = validateManifest(manifest);
		expect(errors).toEqual([]);
	});
});
