import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	_resetDeprecationWarningsForTests,
	GLOBAL_MANIFEST,
	GLOBAL_MANIFEST_ALT,
	globalManifestExists,
	MANIFEST_LEGACY,
	MANIFEST_NEW,
	MANIFEST_NEW_ALT,
	manifestExists,
	resolveGlobalManifestPath,
	resolveManifestPath,
} from "../../src/core/filenames.js";

const cleanups: string[] = [];

afterEach(async () => {
	while (cleanups.length > 0) {
		const dir = cleanups.pop();
		if (dir) await rm(dir, { recursive: true, force: true });
	}
});

beforeEach(() => {
	_resetDeprecationWarningsForTests();
});

async function makeTmp(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "skilltree-filenames-"));
	cleanups.push(dir);
	return dir;
}

function captureWarnings(fn: () => void): string[] {
	const warnings: string[] = [];
	const original = console.warn;
	console.warn = (msg: string) => {
		warnings.push(msg);
	};
	try {
		fn();
	} finally {
		console.warn = original;
	}
	return warnings;
}

describe("default manifest extension", () => {
	test("MANIFEST_NEW is skilltree.yml (.yml is canonical)", () => {
		expect(MANIFEST_NEW).toBe("skilltree.yml");
	});

	test("MANIFEST_NEW_ALT is skilltree.yaml (deprecated default)", () => {
		expect(MANIFEST_NEW_ALT).toBe("skilltree.yaml");
	});

	test("GLOBAL_MANIFEST is global.yml (.yml is canonical)", () => {
		expect(GLOBAL_MANIFEST).toBe("global.yml");
	});

	test("GLOBAL_MANIFEST_ALT is global.yaml (deprecated default)", () => {
		expect(GLOBAL_MANIFEST_ALT).toBe("global.yaml");
	});
});

describe("resolveManifestPath — .yaml / .yml support", () => {
	test("returns skilltree.yaml when only .yaml exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skilltree.yaml"), "");
		const warnings = captureWarnings(() => {
			const { path, filename } = resolveManifestPath(dir);
			expect(filename).toBe("skilltree.yaml");
			expect(path).toBe(join(dir, "skilltree.yaml"));
		});
		// Side-effect: emits a deprecation warning steering users toward .yml
		expect(warnings.some((w) => /\.yml.*default|skilltree\.yml/i.test(w))).toBe(true);
	});

	test("returns skilltree.yml when only .yml exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skilltree.yml"), "");
		const warnings = captureWarnings(() => {
			const { path, filename } = resolveManifestPath(dir);
			expect(filename).toBe("skilltree.yml");
			expect(path).toBe(join(dir, "skilltree.yml"));
		});
		// .yml is the new canonical default — no warning expected.
		expect(warnings).toEqual([]);
	});

	test("emits deprecation warning at most once per process for .yaml", async () => {
		const dirA = await makeTmp();
		const dirB = await makeTmp();
		await writeFile(join(dirA, "skilltree.yaml"), "");
		await writeFile(join(dirB, "skilltree.yaml"), "");
		const warnings = captureWarnings(() => {
			resolveManifestPath(dirA);
			resolveManifestPath(dirB);
		});
		const yamlWarnings = warnings.filter((w) => /skilltree\.yml/i.test(w));
		expect(yamlWarnings.length).toBe(1);
	});

	test("throws when both skilltree.yaml and skilltree.yml exist", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skilltree.yaml"), "");
		await writeFile(join(dir, "skilltree.yml"), "");
		expect(() => resolveManifestPath(dir)).toThrow(/both .* exist/i);
	});

	test("returns default skilltree.yaml when neither exists", async () => {
		const dir = await makeTmp();
		const { path, filename } = resolveManifestPath(dir);
		expect(filename).toBe(MANIFEST_NEW);
		expect(path).toBe(join(dir, MANIFEST_NEW));
	});

	test("falls back to skillkit.yaml legacy when no skilltree.* exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skillkit.yaml"), "");
		const { filename } = resolveManifestPath(dir);
		expect(filename).toBe(MANIFEST_LEGACY);
	});

	test("prefers skilltree.yaml over legacy skillkit.yaml when both exist", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skilltree.yaml"), "");
		await writeFile(join(dir, "skillkit.yaml"), "");
		captureWarnings(() => {
			const { filename } = resolveManifestPath(dir);
			expect(filename).toBe("skilltree.yaml");
		});
	});

	test("prefers skilltree.yml over legacy skillkit.yaml when both exist", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skilltree.yml"), "");
		await writeFile(join(dir, "skillkit.yaml"), "");
		const { filename } = resolveManifestPath(dir);
		expect(filename).toBe(MANIFEST_NEW);
	});
});

describe("manifestExists — .yaml / .yml support", () => {
	test("true when skilltree.yaml exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skilltree.yaml"), "");
		expect(manifestExists(dir)).toBe(true);
	});

	test("true when skilltree.yml exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skilltree.yml"), "");
		expect(manifestExists(dir)).toBe(true);
	});

	test("true when only legacy skillkit.yaml exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "skillkit.yaml"), "");
		expect(manifestExists(dir)).toBe(true);
	});

	test("false when no manifest exists", async () => {
		const dir = await makeTmp();
		expect(manifestExists(dir)).toBe(false);
	});
});

describe("resolveGlobalManifestPath — .yaml / .yml support", () => {
	test("returns global.yaml when only .yaml exists, and warns", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "global.yaml"), "");
		const warnings = captureWarnings(() => {
			const { filename } = resolveGlobalManifestPath(dir);
			expect(filename).toBe("global.yaml");
		});
		expect(warnings.some((w) => /global\.yml/i.test(w))).toBe(true);
	});

	test("returns global.yml when only .yml exists, no warning", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "global.yml"), "");
		const warnings = captureWarnings(() => {
			const { filename } = resolveGlobalManifestPath(dir);
			expect(filename).toBe("global.yml");
		});
		expect(warnings).toEqual([]);
	});

	test("throws when both global.yaml and global.yml exist", async () => {
		const dir = await makeTmp();
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "global.yaml"), "");
		await writeFile(join(dir, "global.yml"), "");
		expect(() => resolveGlobalManifestPath(dir)).toThrow(/both .* exist/i);
	});

	test("returns default global.yaml when neither exists", async () => {
		const dir = await makeTmp();
		const { filename } = resolveGlobalManifestPath(dir);
		expect(filename).toBe(GLOBAL_MANIFEST);
	});
});

describe("globalManifestExists — .yaml / .yml support", () => {
	test("true when global.yaml exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "global.yaml"), "");
		expect(globalManifestExists(dir)).toBe(true);
	});

	test("true when global.yml exists", async () => {
		const dir = await makeTmp();
		await writeFile(join(dir, "global.yml"), "");
		expect(globalManifestExists(dir)).toBe(true);
	});

	test("false when none exist", async () => {
		const dir = await makeTmp();
		expect(globalManifestExists(dir)).toBe(false);
	});
});

// The warn-once gate is keyed per deprecation category so silencing one
// (e.g. project .yaml) doesn't silence unrelated deprecations the user
// actually needs to see. Regression guard for the Set-based warnOnce helper.
describe("warnOnce gate is independent across deprecation categories", () => {
	test("project .yaml warning does not suppress legacy skillkit.yaml warning", async () => {
		const dirA = await makeTmp();
		const dirB = await makeTmp();
		await writeFile(join(dirA, "skilltree.yaml"), "");
		await writeFile(join(dirB, "skillkit.yaml"), "");

		const warnings = captureWarnings(() => {
			resolveManifestPath(dirA); // emits .yaml deprecation
			resolveManifestPath(dirB); // emits skillkit.yaml deprecation
		});

		expect(warnings.some((w) => /skilltree\.yml/i.test(w) && !/skillkit/i.test(w))).toBe(true);
		expect(warnings.some((w) => /skillkit\.yaml/i.test(w))).toBe(true);
	});

	test("project .yaml warning does not suppress global .yaml warning", async () => {
		const projectDir = await makeTmp();
		const globalDir = await makeTmp();
		await writeFile(join(projectDir, "skilltree.yaml"), "");
		await writeFile(join(globalDir, "global.yaml"), "");

		const warnings = captureWarnings(() => {
			resolveManifestPath(projectDir);
			resolveGlobalManifestPath(globalDir);
		});

		expect(warnings.some((w) => /skilltree\.yml/i.test(w))).toBe(true);
		expect(warnings.some((w) => /global\.yml/i.test(w))).toBe(true);
	});

	test("_resetDeprecationWarningsForTests clears every category, not just one", async () => {
		const projectDir = await makeTmp();
		const legacyDir = await makeTmp();
		const globalDir = await makeTmp();
		await writeFile(join(projectDir, "skilltree.yaml"), "");
		await writeFile(join(legacyDir, "skillkit.yaml"), "");
		await writeFile(join(globalDir, "global.yaml"), "");

		// First pass arms all three gates.
		captureWarnings(() => {
			resolveManifestPath(projectDir);
			resolveManifestPath(legacyDir);
			resolveGlobalManifestPath(globalDir);
		});

		// Second pass without reset is silent — confirms the gates are armed.
		const silent = captureWarnings(() => {
			resolveManifestPath(projectDir);
			resolveManifestPath(legacyDir);
			resolveGlobalManifestPath(globalDir);
		});
		expect(silent).toEqual([]);

		// Reset, then re-trigger — every category must warn again.
		_resetDeprecationWarningsForTests();
		const after = captureWarnings(() => {
			resolveManifestPath(projectDir);
			resolveManifestPath(legacyDir);
			resolveGlobalManifestPath(globalDir);
		});
		expect(after.some((w) => /skilltree\.yml/i.test(w) && !/skillkit/i.test(w))).toBe(true);
		expect(after.some((w) => /skillkit\.yaml/i.test(w))).toBe(true);
		expect(after.some((w) => /global\.yml/i.test(w))).toBe(true);
	});
});
