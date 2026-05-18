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
 * Outcome of a non-mutating `git ls-remote` probe. Used by `skilltree doctor`
 * (Nitrogen Phase 3) to check whether a registry URL is reachable without
 * pulling anything into the cache.
 *
 * `reason` discriminates between authentication failures (the URL is real
 * but our credentials don't permit access), transport timeouts (network
 * stall or DNS lag), name-resolution / connection failures (`unreachable`),
 * and anything else simpleGit surfaces (`other`).
 */
export type LsRemoteOutcome =
	| { ok: true }
	| { ok: false; reason: "timeout" | "auth" | "unreachable" | "other"; detail: string };

/**
 * Probe a remote URL with `git ls-remote` and a hard timeout. Read-only:
 * never writes to the cache, never updates refs. The 5s default matches
 * spec D9 for the doctor reachability check.
 *
 * Implementation: races `simpleGit().listRemote([url])` against a setTimeout.
 * On timeout the underlying git process keeps running until git itself
 * gives up; we don't bother killing it because the outcome has already
 * been reported. Auth-failure detection uses stderr-text heuristics
 * (`Authentication failed`, `could not read Username`, `Permission denied`)
 * — we force `LC_ALL=C`/`LANG=C` on the spawn so those English strings
 * appear regardless of the user's locale (issue #114). Also set
 * `GIT_TERMINAL_PROMPT=0` so a private-repo URL never blocks waiting
 * for credentials when ssh/key-helpers aren't configured.
 */
export async function lsRemote(
	url: string,
	opts: { timeoutMs?: number } = {},
): Promise<LsRemoteOutcome> {
	const timeoutMs = opts.timeoutMs ?? 5000;
	const cloneUrl = toGitCloneUrl(url);
	const git = simpleGit().env({
		...process.env,
		LC_ALL: "C",
		LANG: "C",
		GIT_TERMINAL_PROMPT: "0",
	});
	const probe: Promise<LsRemoteOutcome> = git
		.listRemote([cloneUrl])
		.then(() => ({ ok: true as const }))
		.catch((err: unknown): LsRemoteOutcome => {
			const detail = err instanceof Error ? err.message : String(err);
			const lc = detail.toLowerCase();
			if (
				lc.includes("authentication failed") ||
				lc.includes("could not read username") ||
				lc.includes("permission denied")
			) {
				return { ok: false, reason: "auth", detail };
			}
			if (
				lc.includes("could not resolve") ||
				lc.includes("connection refused") ||
				lc.includes("connection timed out") ||
				lc.includes("network is unreachable") ||
				lc.includes("name or service not known")
			) {
				return { ok: false, reason: "unreachable", detail };
			}
			return { ok: false, reason: "other", detail };
		});
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<LsRemoteOutcome>((resolve) => {
		timer = setTimeout(
			() =>
				resolve({
					ok: false,
					reason: "timeout",
					detail: `timed out after ${timeoutMs}ms`,
				}),
			timeoutMs,
		);
	});
	try {
		return await Promise.race([probe, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
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
 * The fetch refspec we install on every bare cache. `git clone --bare` deliberately
 * leaves `remote.origin.fetch` unset (see `git-clone(1)`: "neither remote-tracking
 * branches nor the related configuration variables are created"), so a subsequent
 * `git fetch --tags` resolves the remote's HEAD into FETCH_HEAD only and never
 * updates `refs/heads/*` — new commits on the default branch are silently missed
 * (issue #55).
 *
 * Installing this refspec — both on fresh clones and on pre-existing caches —
 * gives us mirror-style branch updates without the broader `--mirror` semantics
 * (PR refs, replace refs, etc.).
 */
const BARE_FETCH_REFSPEC = "+refs/heads/*:refs/heads/*";

/**
 * Backfill the branch-mirroring fetch refspec into a bare cache, replacing
 * any pre-existing value(s). Use `--replace-all` rather than a plain
 * `git config name value`: plain set fails with exit 5 ("cannot overwrite
 * multiple values with a single value") when the cache already has more
 * than one `remote.origin.fetch` entry — which can happen with caches
 * produced by `git clone --mirror` or hand-edited configs. That failure
 * would break the very `registry update` path this fix exists to rescue.
 *
 * Net behavior: after this call, the cache has exactly one fetch refspec,
 * `BARE_FETCH_REFSPEC`. We intentionally overwrite broader refspecs too
 * (e.g. mirror's `+refs/*:refs/*`); skilltree exclusively manages the
 * cache directory, so narrowing to heads-only is the canonical state.
 *
 * Idempotent: rewriting the same value is a no-op on disk semantics and
 * cheap enough to run on every fetch. See issue #55.
 */
async function ensureBareFetchRefspec(git: ReturnType<typeof simpleGit>): Promise<void> {
	await git.raw(["config", "--replace-all", "remote.origin.fetch", BARE_FETCH_REFSPEC]);
}

/**
 * Clone a bare repo if it doesn't exist, or fetch if it does.
 * If the directory exists but is not a valid bare repo (e.g., empty dir
 * from a failed previous clone), it is removed and re-cloned. If the
 * cached repo's `origin` URL differs from `repoUrl` (user edited the
 * source in skilltree.yml or config.yaml), the cache is invalidated
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
						// Backfill the refspec on caches produced by older
						// skilltree builds before fetching — see issue #55.
						await ensureBareFetchRefspec(git);
						// Two-fetch dance to keep branch-vs-tag pruning
						// asymmetric — both are required, and `--prune` /
						// `--prune-tags` flags on a single invocation cannot
						// express the split:
						//
						// 1) Branches (no prune): with our configured refspec
						//    `+refs/heads/*:refs/heads/*`, a `--prune` would
						//    delete local `refs/heads/<branch>` whenever the
						//    upstream removed or renamed the branch. Tagless
						//    dep resolution reads
						//    `getCommitSha(cache, getDefaultBranch(cache))`
						//    — pruning the cached default branch under a
						//    rename would turn that into a hard error
						//    instead of returning the last-known commit.
						// 2) Tags (prune): a maintainer revoking a tag (e.g.
						//    pointing at a leaked-credential or malicious
						//    commit) MUST propagate to consumers. Without
						//    pruning, `resolveOneRepo` in `src/core/graph.ts`
						//    keeps resolving the dead tag against the cached
						//    commit forever.
						//
						// The explicit `+refs/tags/*:refs/tags/*` on the
						// second call overrides the configured branch
						// refspec for that invocation, so `--prune` is
						// scoped to tags only.
						await git.fetch(["--tags"]);
						await git.fetch(["--prune", "origin", "+refs/tags/*:refs/tags/*"]);
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
	// `-o origin` locks the remote name regardless of the user's
	// `clone.defaultRemoteName` git config — otherwise users who've set
	// that globally (e.g. to "upstream") would get a cache whose remote
	// has a non-`origin` name, breaking `ensureBareFetchRefspec` (which
	// writes `remote.origin.fetch`), the drift check (which reads
	// `remote.origin.url`), and the tag-pruning fetch below (which
	// references `origin` explicitly).
	await simpleGit().clone(gitUrl, targetDir, ["--bare", "-o", "origin"]);
	// Fresh clones need the refspec too — `git clone --bare` doesn't set one.
	await ensureBareFetchRefspec(simpleGit(targetDir));
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
		// Empty origin means a `[remote "origin"]` header with no url line — a
		// corrupt/partial clone. Treat as drift so the caller re-clones rather
		// than silently fetching against a nonexistent remote.
		if (!cachedOrigin) return true;
		return normalizeGitUrl(cachedOrigin) !== normalizeGitUrl(toGitCloneUrl(expectedUrl));
	} catch {
		// Missing/unreadable origin — let the caller fall through to re-clone.
		return true;
	}
}

export function getCacheDir(): string {
	return CACHE_DIR;
}
