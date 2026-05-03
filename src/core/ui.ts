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
