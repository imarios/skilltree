import { homedir } from "node:os";

/**
 * Replace a leading `~` with the user's home directory.
 * If the path doesn't start with `~`, return it unchanged.
 *
 * Note: only `~` and `~/` are expanded. `~user` and `~user/...` (another
 * user's home directory) are deliberately unsupported — Node has no
 * built-in for it and skilltree is a single-user dev tool. Both forms
 * pass through as literal strings; downstream `stat()` calls fail with a
 * clear "Local path does not exist" error echoing the original input.
 */
export function expandTilde(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return `${homedir()}${p.slice(1)}`;
	return p;
}

/**
 * Replace a leading home directory with `~`.
 * Inverse of expandTilde — used when writing global lockfile entries.
 */
export function collapseTilde(p: string): string {
	const home = homedir();
	if (p === home) return "~";
	if (p.startsWith(`${home}/`)) return `~${p.slice(home.length)}`;
	return p;
}

/**
 * Returns true if the value looks like a local filesystem path
 * (starts with `~/`, `/`, or `./`), as opposed to a git URL.
 */
export function isLocalSource(value: string): boolean {
	return value.startsWith("~/") || value.startsWith("/") || value.startsWith("./");
}

/** The global skilltree config directory: `~/.skilltree` */
export function getGlobalDir(): string {
	return expandTilde("~/.skilltree");
}

/** The global install base for Claude Code: `~/.claude` */
export function getGlobalInstallBase(): string {
	return expandTilde("~/.claude");
}

/** Strip leading `./` from a path. Used to normalize paths for git operations. */
export function stripDotSlash(p: string): string {
	return p.startsWith("./") ? p.slice(2) : p;
}

/**
 * Canonical form of a path for semantic equality comparison.
 *
 * Normalizes any path-shaped string — git tree paths (`./foo`, `foo`,
 * `skills/foo`) and absolute filesystem paths (`/Users/...`, `~/...` after
 * `expandTilde`) alike. Several surface forms refer to the same location
 * (leading `./`, trailing slashes, duplicate slashes, repeated `./` prefixes);
 * `canonicalPath` produces a single comparison key.
 *
 * Contract:
 * - Strip ALL leading `./` sequences.
 * - Strip leading `/` (lossy for absolute paths — callers that need the
 *   leading `/` back must re-prepend it; see `canonicalSource` in
 *   `src/core/deps.ts` for the pattern).
 * - Collapse repeated `/` to a single `/`.
 * - Trim trailing `/`.
 * - Does NOT resolve `..` segments (callers that care use `hasDotDotSegment`).
 * - Does NOT touch path separators (`\`); we target POSIX paths.
 *
 * Use this wherever you need to ask "do these two paths refer to the same
 * location?" Do NOT feed the result back to git or the filesystem without
 * re-adding the leading `/` when the input was absolute.
 */
export function canonicalPath(p: string): string {
	const normalized = p
		.replace(/^(?:\.\/|\/)+/, "")
		.replace(/\/\.(?=\/|$)/g, "") // strip embedded /./ segments (but not /..)
		.replace(/\/+/g, "/")
		.replace(/\/+$/, "");
	// `.` alone refers to the current directory / root, same as the empty
	// result produced by other root forms (`/`, `./`, `././`). Normalize to
	// empty so all root representations compare equal.
	return normalized === "." ? "" : normalized;
}
