import { homedir } from "node:os";

/**
 * Replace a leading `~` with the user's home directory.
 * If the path doesn't start with `~`, return it unchanged.
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
