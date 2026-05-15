import { describe, expect, test } from "bun:test";
import { isPubliclyVisible } from "../../src/core/visibility.js";
import type { Dependency } from "../../src/types.js";

describe("isPubliclyVisible", () => {
	// PS1: visible iff group === "dependencies" AND publish !== false.

	const cases: Array<{
		label: string;
		entry: Dependency;
		group: "dependencies" | "dev-dependencies";
		expected: boolean;
	}> = [
		{
			label: "local in dependencies, publish omitted → visible",
			entry: { local: "./skills/x" },
			group: "dependencies",
			expected: true,
		},
		{
			label: "local in dependencies, publish: true → visible",
			entry: { local: "./skills/x", publish: true },
			group: "dependencies",
			expected: true,
		},
		{
			label: "local in dependencies, publish: false → hidden",
			entry: { local: "./skills/x", publish: false },
			group: "dependencies",
			expected: false,
		},
		{
			label: "local in dev-dependencies, publish omitted → hidden",
			entry: { local: "./skills/x" },
			group: "dev-dependencies",
			expected: false,
		},
		{
			label: "local in dev-dependencies, publish: true → still hidden (group wins)",
			entry: { local: "./skills/x", publish: true },
			group: "dev-dependencies",
			expected: false,
		},
		{
			label: "local in dev-dependencies, publish: false → hidden",
			entry: { local: "./skills/x", publish: false },
			group: "dev-dependencies",
			expected: false,
		},
		{
			label: "remote (repo:) in dependencies → visible (publish doesn't apply)",
			entry: { repo: "github.com/x/y", path: "skills/x" },
			group: "dependencies",
			expected: true,
		},
		{
			label: "remote (source:) in dependencies → visible",
			entry: { source: "vibes", path: "skills/x" },
			group: "dependencies",
			expected: true,
		},
		{
			label: "remote in dev-dependencies → hidden by group",
			entry: { repo: "github.com/x/y", path: "skills/x" },
			group: "dev-dependencies",
			expected: false,
		},
	];

	for (const c of cases) {
		test(c.label, () => {
			expect(isPubliclyVisible(c.entry, c.group)).toBe(c.expected);
		});
	}
});
