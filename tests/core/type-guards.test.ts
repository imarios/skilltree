import { describe, expect, test } from "bun:test";
import {
	type Dependency,
	isLocalDependency,
	isPackDependency,
	isRemoteDependency,
	isSourceDependency,
} from "../../src/types.js";

describe("type guards — PackDependency disambiguation", () => {
	test("G1 — isRemoteDependency excludes PackDependency carrying repo", () => {
		const packRef = { pack: "x", repo: "y" } as unknown as Dependency;
		expect(isRemoteDependency(packRef)).toBe(false);

		const realRemote: Dependency = { repo: "y", path: "z" };
		expect(isRemoteDependency(realRemote)).toBe(true);
	});

	test("G2 — isSourceDependency excludes PackDependency carrying source", () => {
		const packRef = { pack: "x", source: "y" } as unknown as Dependency;
		expect(isSourceDependency(packRef)).toBe(false);

		const realSourced = { source: "y", path: "z" } as Dependency;
		expect(isSourceDependency(realSourced)).toBe(true);
	});

	test("G3 — isLocalDependency unaffected", () => {
		const packRef = { pack: "x" } as unknown as Dependency;
		expect(isLocalDependency(packRef)).toBe(false);

		const realLocal: Dependency = { local: "./x" };
		expect(isLocalDependency(realLocal)).toBe(true);
	});

	test("G4 — isPackDependency recognizes all three shapes", () => {
		expect(isPackDependency({ pack: "x" } as unknown as Dependency)).toBe(true);
		expect(isPackDependency({ pack: "x", repo: "y" } as unknown as Dependency)).toBe(true);
		expect(isPackDependency({ pack: "x", source: "y" } as unknown as Dependency)).toBe(true);

		expect(isPackDependency({ repo: "y", path: "z" } as Dependency)).toBe(false);
		expect(isPackDependency({ source: "y", path: "z" } as Dependency)).toBe(false);
		expect(isPackDependency({ local: "./x" } as Dependency)).toBe(false);
	});
});
