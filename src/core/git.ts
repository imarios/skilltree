import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";

const CACHE_DIR = join(homedir(), ".skilltree", "cache");

/**
 * Normalize a repo URL into a cache path.
 * "github.com/user/repo" → "{cache}/github.com/user/repo"
 * Strips protocol prefixes and trailing .git
 */
export function repoCachePath(repoUrl: string): string {
	return join(CACHE_DIR, normalizeGitUrl(repoUrl));
}

/**
 * Ensure a bare repo is cached locally. Clones if missing, fetches if existing.
 */
export async function ensureCached(repoUrl: string): Promise<string> {
	const cachePath = repoCachePath(repoUrl);
	await cloneOrFetchBare(repoUrl, cachePath);
	return cachePath;
}

/**
 * List all tags from a cached repo.
 */
export async function listTags(cachePath: string): Promise<string[]> {
	const git = simpleGit(cachePath);
	const result = await git.tags();
	return result.all;
}

/**
 * Read a file's content at a specific ref (tag, commit, branch).
 */
export async function readFileAtRef(
	cachePath: string,
	ref: string,
	filePath: string,
): Promise<string> {
	const git = simpleGit(cachePath);
	return git.show([`${ref}:${filePath}`]);
}

/**
 * Check whether a path (file or directory) exists at a specific ref.
 */
export async function pathExistsAtRef(
	cachePath: string,
	ref: string,
	filePath: string,
): Promise<boolean> {
	const git = simpleGit(cachePath);
	try {
		await git.raw(["cat-file", "-e", `${ref}:${filePath}`]);
		return true;
	} catch {
		return false;
	}
}

/**
 * List directory contents at a specific ref.
 * Returns entry names (files and dirs — dirs have trailing /).
 */
export async function listDirAtRef(
	cachePath: string,
	ref: string,
	dirPath: string,
): Promise<string[]> {
	const git = simpleGit(cachePath);
	const treeArg = dirPath === "." ? ref : `${ref}:${dirPath}`;
	const result = await git.raw(["ls-tree", "--name-only", treeArg]);
	return result
		.trim()
		.split("\n")
		.filter((l) => l.length > 0);
}

/**
 * Get the HEAD commit SHA of a ref.
 */
export async function getCommitSha(cachePath: string, ref: string): Promise<string> {
	const git = simpleGit(cachePath);
	const sha = await git.revparse([ref]);
	return sha.trim();
}

/**
 * Get the default branch name (usually main or master).
 */
export async function getDefaultBranch(cachePath: string): Promise<string> {
	const git = simpleGit(cachePath);
	try {
		const head = await git.raw(["symbolic-ref", "HEAD"]);
		return head.trim().replace("refs/heads/", "");
	} catch {
		return "main";
	}
}

/**
 * Normalize a git URL into a canonical display form.
 * Strips ALL protocol prefixes (including git@), .git suffix, and trailing slashes.
 * Use for cache paths, name inference, and display — NOT for cloneable storage.
 * "https://github.com/user/repo.git" → "github.com/user/repo"
 * "git@github.com:user/repo" → "github.com/user/repo"
 */
export function normalizeGitUrl(url: string): string {
	return url
		.replace(/^https?:\/\//, "")
		.replace(/^git@/, "")
		.replace(/:([^/])/, "/$1")
		.replace(/\.git$/, "")
		.replace(/\/+$/, "");
}

/**
 * Clean a git URL for storage. Preserves transport info (git@, https://)
 * so the URL remains cloneable. Only strips .git suffix and trailing slashes.
 * "https://github.com/user/repo.git" → "https://github.com/user/repo"
 * "git@github.com:user/repo.git" → "git@github.com:user/repo"
 * "github.com/user/repo" → "github.com/user/repo"
 */
export function cleanGitUrl(url: string): string {
	return url.replace(/\.git$/, "").replace(/\/+$/, "");
}

/**
 * Convert a repo identifier to a URL suitable for git clone.
 * Local paths and full URLs are returned as-is.
 * Bare hostnames get https:// prepended.
 */
export function toGitCloneUrl(repo: string): string {
	// SSH SCP syntax (git@host:path), full URLs, and local paths are already valid
	if (repo.includes("://") || repo.startsWith("/") || repo.startsWith("git@")) return repo;
	return `https://${repo}`;
}

/**
 * Clone a bare repo if it doesn't exist, or fetch if it does.
 * If the directory exists but is not a valid bare repo (e.g., empty dir
 * from a failed previous clone), it is removed and re-cloned. If the
 * cached repo's `origin` URL differs from `repoUrl` (user edited the
 * source in skilltree.yaml or config.yaml), the cache is invalidated
 * and re-cloned against the new URL — a plain fetch would silently
 * pull from the stale remote.
 */
export async function cloneOrFetchBare(repoUrl: string, targetDir: string): Promise<void> {
	if (existsSync(targetDir)) {
		// Verify it's a valid bare repo with a configured remote before fetching.
		// HEAD alone is insufficient — git init writes HEAD before the clone
		// configures the remote, so a clone interrupted between init and remote-add
		// would have HEAD but no remote to fetch from.
		const configFile = join(targetDir, "config");
		if (existsSync(configFile)) {
			try {
				const configContent = await readFile(configFile, "utf-8");
				if (configContent.includes('[remote "origin"]')) {
					const git = simpleGit(targetDir);
					if (await isOriginUrlDrifted(git, repoUrl)) {
						await rm(targetDir, { recursive: true, force: true });
					} else {
						await git.fetch(["--tags", "--prune"]);
						return;
					}
				}
			} catch {
				// Config unreadable — fall through to re-clone
			}
		}
		// Corrupt/incomplete directory, or drift path that didn't `return` — ensure removed.
		if (existsSync(targetDir)) {
			await rm(targetDir, { recursive: true, force: true });
		}
	}
	await mkdir(targetDir, { recursive: true });
	const gitUrl = toGitCloneUrl(repoUrl);
	await simpleGit().clone(gitUrl, targetDir, ["--bare"]);
}

/**
 * Compare the cached repo's `origin` URL against the expected URL. Both
 * sides are run through `toGitCloneUrl` + `normalizeGitUrl` so cosmetic
 * differences (missing https://, trailing .git, etc.) don't cause a
 * spurious re-clone. Returns true when the resolved URLs disagree.
 */
async function isOriginUrlDrifted(
	git: ReturnType<typeof simpleGit>,
	expectedUrl: string,
): Promise<boolean> {
	try {
		const cachedOrigin = (await git.raw(["config", "--get", "remote.origin.url"])).trim();
		if (!cachedOrigin) return false;
		return normalizeGitUrl(cachedOrigin) !== normalizeGitUrl(toGitCloneUrl(expectedUrl));
	} catch {
		// Missing/unreadable origin — let the caller fall through to re-clone.
		return true;
	}
}

export function getCacheDir(): string {
	return CACHE_DIR;
}
