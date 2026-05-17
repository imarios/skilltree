import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { printTable } from "../../src/core/ui.js";

function captureConsole(): { logs: string[]; restore: () => void } {
	const logs: string[] = [];
	const original = console.log;
	console.log = (...args: unknown[]) => logs.push(args.join(" "));
	return { logs, restore: () => (console.log = original) };
}

// Strip ANSI color codes for content assertions; we test colorization
// separately by inspecting the raw string.
function stripAnsi(s: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

interface Row {
	name: string;
	version: string;
}

let cap: ReturnType<typeof captureConsole>;
beforeEach(() => {
	cap = captureConsole();
});
afterEach(() => {
	cap.restore();
});

describe("printTable", () => {
	test("prints header, divider, then one line per row", () => {
		const rows: Row[] = [
			{ name: "alpha", version: "1.0.0" },
			{ name: "beta", version: "2.1.3" },
		];
		printTable(rows, [
			{ header: "Name", value: (r) => r.name },
			{ header: "Version", value: (r) => r.version },
		]);

		expect(cap.logs.length).toBe(4); // header + divider + 2 rows
		const plain = cap.logs.map(stripAnsi);
		expect(plain[0]).toContain("Name");
		expect(plain[0]).toContain("Version");
		expect(plain[1]).toMatch(/^-+$/);
		expect(plain[2]).toContain("alpha");
		expect(plain[2]).toContain("1.0.0");
		expect(plain[3]).toContain("beta");
		expect(plain[3]).toContain("2.1.3");
	});

	test("column width grows to fit longest cell", () => {
		const rows: Row[] = [
			{ name: "a", version: "1.0.0" },
			{ name: "the-longest-name-here", version: "1.0.0" },
		];
		printTable(rows, [
			{ header: "Name", value: (r) => r.name },
			{ header: "Version", value: (r) => r.version },
		]);
		const plain = cap.logs.map(stripAnsi);
		// Header should reserve at least as many chars for Name as the longest cell
		expect(plain[0]).toMatch(/Name {18,}/); // 4-char "Name" + ≥17 trailing spaces to reach 21 wide
		// Divider length covers the full header width
		const headerLen = plain[0]?.length ?? 0;
		expect(plain[1]?.length ?? -1).toBe(headerLen);
	});

	test("header length is the natural minimum width", () => {
		const rows: Row[] = [{ name: "a", version: "1" }];
		printTable(rows, [
			{ header: "Version", value: (r) => r.version },
			{ header: "Name", value: (r) => r.name },
		]);
		const plain = cap.logs.map(stripAnsi);
		// "Version" is 7 chars — first column reserves at least 7, even though
		// its data cell is only 1 char long. Last column ("Name") is not padded.
		expect(plain[2]).toMatch(/^1 {6} {2}a$/);
	});

	test("custom minWidth overrides header length when larger", () => {
		const rows: Row[] = [{ name: "a", version: "1" }];
		printTable(rows, [
			{ header: "N", value: (r) => r.name, minWidth: 10 },
			{ header: "V", value: (r) => r.version },
		]);
		const plain = cap.logs.map(stripAnsi);
		// First column should be padded to 10 chars wide.
		expect(plain[0]).toMatch(/^N {9} {2}V$/);
		expect(plain[2]).toMatch(/^a {9} {2}1$/);
	});

	test("empty rows still prints header + divider, no data lines", () => {
		printTable<Row>(
			[],
			[
				{ header: "Name", value: (r) => r.name },
				{ header: "Version", value: (r) => r.version },
			],
		);
		expect(cap.logs.length).toBe(2);
		const plain = cap.logs.map(stripAnsi);
		expect(plain[0]).toContain("Name");
		expect(plain[0]).toContain("Version");
		expect(plain[1]).toMatch(/^-+$/);
	});

	test("all-empty column collapses to header width", () => {
		const rows = [
			{ name: "alpha", note: "" },
			{ name: "beta", note: "" },
		];
		printTable(rows, [
			{ header: "Name", value: (r) => r.name },
			{ header: "Note", value: (r) => r.note },
		]);
		const plain = cap.logs.map(stripAnsi);
		// "Note" is last column; last column is unpadded. Row line should
		// end at the gutter after the "Name" column with no trailing junk.
		expect(plain[2]).toMatch(/^alpha {2}$/);
		expect(plain[3]).toMatch(/^beta {3}$/); // "beta" padded to width 5 ("alpha")
	});

	test("colorizer wraps data cells but not header", () => {
		const rows: Row[] = [{ name: "alpha", version: "1.0.0" }];
		const tag = "<<C>>";
		printTable(rows, [
			{ header: "Name", value: (r) => r.name, color: (s) => `${tag}${s}${tag}` },
			{ header: "Version", value: (r) => r.version },
		]);
		// Header line must NOT contain the colorizer marker
		expect(cap.logs[0]).not.toContain(tag);
		// Data row line MUST contain the marker around "alpha"
		expect(cap.logs[2]).toContain(`${tag}alpha`);
	});

	test("divider width equals header line width (after stripping ANSI)", () => {
		const rows: Row[] = [
			{ name: "abc", version: "1.0.0" },
			{ name: "defg", version: "2.0.0" },
		];
		printTable(rows, [
			{ header: "Name", value: (r) => r.name },
			{ header: "Version", value: (r) => r.version },
		]);
		const plain = cap.logs.map(stripAnsi);
		// Divider matches header length (both pad the last column conceptually);
		// data rows may be shorter because the trailing column is not padEnded.
		expect(plain[1]?.length ?? -1).toBe(plain[0]?.length ?? 0);
	});
});
