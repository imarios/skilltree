/**
 * Minimal gitignore-style glob matcher (publication_surface.md PS6, PS9, PS11).
 *
 * Supports a subset of `.gitignore` patterns:
 *   - Literal segment names (experiments)
 *   - Trailing slash directory marker (experiments + slash)
 *   - Single asterisk within a segment (*.scratch.md)
 *   - Double asterisk across segments (**\/scratch — see note)
 *   - Single-character wildcard (?)
 *   - Leading slash for root anchor (/cache.json)
 *   - Implicit root anchor when pattern contains a slash (skills/foo)
 *   - Floating any-depth when pattern has no slash (*.tmp)
 *
 * Not supported (add if a use case surfaces): negation (!pattern),
 * character classes ([abc]).
 *
 * Matches are tested against forward-slash paths (POSIX). Callers normalize
 * platform separators before testing.
 */
export class IgnoreMatcher {
	private readonly compiled: RegExp[];

	constructor(patterns: Iterable<string>) {
		this.compiled = [];
		for (const raw of patterns) {
			const trimmed = raw.trim();
			if (!trimmed) continue;
			if (trimmed.startsWith("#")) continue;
			this.compiled.push(compilePattern(trimmed));
		}
	}

	/**
	 * True when `path` matches any pattern in this matcher. The path is
	 * relative to whichever scope the patterns were authored for (entity
	 * root for `exclude:` patterns, repo root for `.skilltreeignore`).
	 */
	ignores(path: string): boolean {
		const normalized = path.replace(/\/+$/, "");
		return this.compiled.some((re) => re.test(normalized));
	}

	get isEmpty(): boolean {
		return this.compiled.length === 0;
	}
}

function compilePattern(pattern: string): RegExp {
	let p = pattern;

	// Trailing slash means directory match; strip it and the regex suffix
	// `(/.*)?$` covers both the dir itself and files beneath it.
	if (p.endsWith("/")) p = p.slice(0, -1);

	// Leading slash anchors to start.
	const rootAnchored = p.startsWith("/");
	if (rootAnchored) p = p.slice(1);

	const containsSlash = p.includes("/");

	// Escape regex metas, then translate glob chars in order. `?` is
	// translated FIRST so the `(?:.*/)?` placeholder below isn't mangled
	// by the trailing replace. `**` is processed before `*` so it doesn't
	// collapse to `[^/]*[^/]*`. `**/` is processed before `**` so a
	// trailing slash means "zero+ directories" rather than "zero+ chars".
	// Placeholders use multi-byte ASCII unlikely to appear in user input.
	const STAR_STAR_SLASH = "\u{1FFFE}";
	const STAR_STAR = "\u{1FFFF}";
	const re = p
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\?/g, "[^/]")
		.replace(/\*\*\//g, STAR_STAR_SLASH)
		.replace(/\*\*/g, STAR_STAR)
		.replace(/\*/g, "[^/]*")
		.replace(new RegExp(STAR_STAR, "g"), ".*")
		.replace(new RegExp(STAR_STAR_SLASH, "g"), "(?:.*/)?");

	if (containsSlash || rootAnchored) {
		return new RegExp(`^${re}(?:/.*)?$`);
	}
	return new RegExp(`(?:^|.*/)${re}(?:/.*)?$`);
}
