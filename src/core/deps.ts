import type { Dependency } from "../types.js";
import { canonicalPath, expandTilde, isLocalSource } from "./paths.js";

/**
 * Canonical identity of a dependency's source for semantic equality.
 *
 * A dependency's "source" (where the entity actually comes from) can be
 * expressed in several forms that point at the same resource:
 *
 * - `{repo: <url>}` — direct remote.
 * - `{source: <alias>}` where `sources[alias] = <url>` — same remote via alias.
 * - `{source: <alias>}` where `sources[alias]` is a local path — same local
 *   filesystem target as a bare `{local: <joined-path>}` entry.
 * - `{local: <path>}` — direct local.
 *
 * `canonicalSource` returns a single string that equals for deps pointing at
 * the same source and differs otherwise. Use it wherever deps are compared
 * for equivalence (e.g., overwrite detection). Do NOT use for install or
 * storage — those keep the original, user-authored shape.
 *
 * Contract:
 * - Remote (repo or alias-to-URL) → the URL.
 * - Remote alias with no entry in `sources` → `"unresolved source alias: <alias>"`
 *   (unspoofable — no real git URL begins with whitespace).
 * - Local path (direct or alias-to-local-path) → `"local:<expanded-absolute-path>"`.
 * - Any unrecognized / empty shape → `"local"`.
 */
export function canonicalSource(
	dep: Dependency | undefined,
	sources?: Record<string, string>,
): string {
	if (!dep) return "local";

	if ("repo" in dep && dep.repo) return dep.repo;

	if ("source" in dep && dep.source) {
		const resolved = sources?.[dep.source];
		// Unspoofable sentinel — no git URL scheme begins with spaces, so a
		// user-authored repo URL can't collide with this fallback, yet the
		// string is human-readable for warning messages.
		if (!resolved) return `unresolved source alias: ${dep.source}`;
		if (isLocalSource(resolved)) {
			const base = expandTilde(resolved);
			const path = "path" in dep && typeof dep.path === "string" ? dep.path : "";
			const full = path && path !== "." ? `${base}/${path}` : base;
			return `local:/${canonicalPath(full)}`;
		}
		return resolved;
	}

	if ("local" in dep && dep.local) {
		return `local:/${canonicalPath(expandTilde(dep.local))}`;
	}

	return "local";
}
