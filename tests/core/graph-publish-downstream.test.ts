import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAll } from "../../src/core/graph.js";
import type { Manifest } from "../../src/types.js";
import { createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

// All fixtures put `experimental-refactor` at a non-conventional path so the
// resolver's conventional probe can't rescue it. That way the manifest tier's
// visibility decision is what determines success/failure.

describe("graph — downstream visibility for publish:false (Carbon Phase 4)", () => {
	test("transitive dep marked publish:false in origin produces tailored error", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-publish-downstream-"));

		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  analysis-pipeline:",
			"    local: ./skills/source/analysis-pipeline",
			"  experimental-refactor:",
			"    local: ./skills/source/experimental-refactor",
			"    publish: false",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[
				{
					path: "skills/source/analysis-pipeline",
					name: "analysis-pipeline",
					dependencies: ["experimental-refactor"],
				},
				{ path: "skills/source/experimental-refactor", name: "experimental-refactor" },
			],
			"v1.0.0",
			originManifestYaml,
		);

		const consumer: Manifest = {
			dependencies: {
				"analysis-pipeline": {
					repo: `file://${originRepo}`,
					path: "skills/source/analysis-pipeline",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumer, tempDir);
		expect(result.errors.length).toBeGreaterThan(0);
		const errText = result.errors.join("\n");
		expect(errText).toContain("experimental-refactor");
		expect(errText).toMatch(/publish:\s*false/);
		expect(errText).toContain(`file://${originRepo}`);
		expect(errText).not.toContain("dev-dependencies are not exposed");
	});

	test("dev-dependency case produces the existing dev-dep error (regression)", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-publish-downstream-"));

		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  analysis-pipeline:",
			"    local: ./skills/source/analysis-pipeline",
			"dev-dependencies:",
			"  experimental-refactor:",
			"    local: ./skills/source/experimental-refactor",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[
				{
					path: "skills/source/analysis-pipeline",
					name: "analysis-pipeline",
					dependencies: ["experimental-refactor"],
				},
				{ path: "skills/source/experimental-refactor", name: "experimental-refactor" },
			],
			"v1.0.0",
			originManifestYaml,
		);

		const consumer: Manifest = {
			dependencies: {
				"analysis-pipeline": {
					repo: `file://${originRepo}`,
					path: "skills/source/analysis-pipeline",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumer, tempDir);
		expect(result.errors.length).toBeGreaterThan(0);
		const errText = result.errors.join("\n");
		expect(errText).toContain("dev-dependencies are not exposed");
		expect(errText).not.toMatch(/publish:\s*false/);
	});

	test("consumer's own manifest entry overrides origin's publish:false", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-publish-downstream-"));

		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  analysis-pipeline:",
			"    local: ./skills/source/analysis-pipeline",
			"  experimental-refactor:",
			"    local: ./skills/source/experimental-refactor",
			"    publish: false",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[
				{
					path: "skills/source/analysis-pipeline",
					name: "analysis-pipeline",
					dependencies: ["experimental-refactor"],
				},
				{ path: "skills/source/experimental-refactor", name: "experimental-refactor" },
			],
			"v1.0.0",
			originManifestYaml,
		);

		const consumer: Manifest = {
			dependencies: {
				"analysis-pipeline": {
					repo: `file://${originRepo}`,
					path: "skills/source/analysis-pipeline",
					version: "*",
				},
				"experimental-refactor": {
					repo: `file://${originRepo}`,
					path: "skills/source/experimental-refactor",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumer, tempDir);
		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:experimental-refactor")).toBeDefined();
	});

	test("origin's publish:true (default) → transitive resolves normally", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-publish-downstream-"));

		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  analysis-pipeline:",
			"    local: ./skills/source/analysis-pipeline",
			"  experimental-refactor:",
			"    local: ./skills/source/experimental-refactor",
			// publish omitted → default true
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[
				{
					path: "skills/source/analysis-pipeline",
					name: "analysis-pipeline",
					dependencies: ["experimental-refactor"],
				},
				{ path: "skills/source/experimental-refactor", name: "experimental-refactor" },
			],
			"v1.0.0",
			originManifestYaml,
		);

		const consumer: Manifest = {
			dependencies: {
				"analysis-pipeline": {
					repo: `file://${originRepo}`,
					path: "skills/source/analysis-pipeline",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumer, tempDir);
		expect(result.errors).toEqual([]);
		expect(result.entities.get("skill:experimental-refactor")).toBeDefined();
	});
});
