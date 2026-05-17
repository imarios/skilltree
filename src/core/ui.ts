import pc from "picocolors";

/** Green checkmark + message for successful operations */
export const success = (msg: string) => console.log(pc.green(`✔ ${msg}`));

/** Yellow warning */
export const warn = (msg: string) => console.warn(pc.yellow(`⚠ ${msg}`));

/** Red error */
export const error = (msg: string) => console.error(pc.red(`✘ ${msg}`));

/** Dim text for secondary info */
export const dim = (msg: string) => pc.dim(msg);

/** Bold text for emphasis */
export const bold = (msg: string) => pc.bold(msg);

/** Cyan for commands and hints the user should run */
export const cmd = (msg: string) => pc.cyan(msg);

/** Format a section header */
export const header = (msg: string) => console.log(pc.bold(msg));

/** Standard banner printed at the top of any command's --dry-run output. */
export const dryRunBanner = () => console.log(pc.yellow("Dry run — no changes will be made.\n"));

/** Styled table header row (bold + underline) */
export const tableHeader = (msg: string) => console.log(pc.bold(pc.underline(msg)));

/** Blue for labels/keys in info displays */
export const label = (msg: string) => pc.blue(msg);

/** Naive English pluralizer: returns `word` for n=1, `${word}s` otherwise. */
export const pluralize = (word: string, n: number): string => (n === 1 ? word : `${word}s`);

/** Column gutter (2 spaces) between adjacent cells in printTable output. */
const TABLE_GUTTER = "  ";

/**
 * Declarative column descriptor for {@link printTable}.
 *
 * - `value` extracts the string contents of the cell for a given row.
 * - `color` optionally wraps each data cell (NOT the header) in a colorizer
 *   like `pc.cyan` or our `dim` helper.
 * - `minWidth` overrides the default minimum width (= `header.length`).
 *   The actual rendered width is `max(minWidth ?? header.length, ...cellLens)`.
 */
export interface ColumnDef<T> {
	header: string;
	value: (row: T) => string;
	color?: (cell: string) => string;
	minWidth?: number;
}

/**
 * Render a bold header, dim divider, and per-row cells for `rows` using the
 * declarative `columns`. Centralizes the width/gutter logic that previously
 * lived inline in `list` and `outdated` (issue #101).
 *
 * Conventions:
 * - Columns are padded with `padEnd` to the same width across header and rows.
 * - The trailing column is NOT padded — colors on the final cell wouldn't
 *   benefit from trailing whitespace, matching the prior hand-written tables.
 * - Divider length matches the visible header length (gutters included), so
 *   the underline lines up regardless of column count.
 * - Empty `rows` still prints the header + divider (callers should short-
 *   circuit earlier with a friendlier "no deps" message when appropriate).
 */
export function printTable<T>(rows: T[], columns: ColumnDef<T>[]): void {
	if (columns.length === 0) return;

	// Pre-extract cell strings once so we don't call `value(row)` twice.
	const cells: string[][] = rows.map((r) => columns.map((c) => c.value(r)));

	const widths = columns.map((col, i) => {
		const min = col.minWidth ?? col.header.length;
		let max = min;
		for (const row of cells) {
			const len = row[i]?.length ?? 0;
			if (len > max) max = len;
		}
		return max;
	});

	const lastIdx = columns.length - 1;
	const headerLine = columns
		.map((col, i) => (i === lastIdx ? col.header : col.header.padEnd(widths[i] ?? 0)))
		.join(TABLE_GUTTER);
	console.log(pc.bold(headerLine));

	const totalWidth = widths.reduce((a, b) => a + b, 0) + TABLE_GUTTER.length * lastIdx;
	console.log(dim("-".repeat(totalWidth)));

	for (const row of cells) {
		const line = row
			.map((cell, i) => {
				const padded = i === lastIdx ? cell : cell.padEnd(widths[i] ?? 0);
				const color = columns[i]?.color;
				return color ? color(padded) : padded;
			})
			.join(TABLE_GUTTER);
		console.log(line);
	}
}

/**
 * Print resolution warnings and throw if errors exist.
 * Used by install, installGlobal, and vendor commands.
 */
export function throwOnResolutionErrors(result: { errors: string[]; warnings: string[] }): void {
	for (const w of result.warnings) {
		warn(w);
	}
	if (result.errors.length > 0) {
		error(`${result.errors.length} unresolved dependencies`);
		for (let i = 0; i < result.errors.length; i++) {
			console.error(`  ${i + 1}. ${result.errors[i]}`);
		}
		throw new Error("Resolution failed");
	}
}

export { pc };
