# Phase 5 Source: 5-Round Hypothesis Review

A hypothesis-driven review across 5 rounds found and fixed 7 issues in the Boron change. Distilling the patterns, three recur:

## Pattern A — Incomplete normalization helpers

**Issues:** R1-H4 (trailing slash), R2-H1 (leading `/`), R3-H3 (repeated `./`). Same helper, three rounds to make complete. Root cause: `stripDotSlash` was named by what it did, not by the invariant it guaranteed. Each new edge case added another `.replace(...)` at the callsite.

**Fix:** one `canonicalPath(p)` in `src/core/paths.ts` with a documented contract — "returns canonical comparison key." Use it everywhere paths are compared. When the next edge case arrives (`a/./b`? Windows `\`? Unicode NFD?), it's added in one place.

## Pattern B — Coercive truthy/falsy checks mask intent

**Issues:** R4-H1 (`!dep.force_path` vs strict `=== true`), R5-H4 (`!entityPath` treats `""` and `undefined` the same).

**Rule of thumb:**
- **Presence check** → `value === undefined` (or `value == null`).
- **Value check** → `value === true` / `value === expectedValue`.
- `!value` only for truly binary booleans where "unset" and "false" should branch together.

## Pattern C — Structural equality where semantic equality is needed

**Issues:** R3-H4 (`repo:` URL compared to `source:` alias), R5-H2 (`local:` path compared to source-aliased-to-local path), R4-H1 (two sites implementing the same concept drifted).

**Fix:** for any type union where two shapes can represent the same resource, have a single canonical-identity helper. `canonicalSource(dep, sources?)` — used wherever deps are compared.

## Pattern D — Destructive replacement without preservation (bonus)

**Issue:** R1-H1 (`force_path` dropped on `skilltree add` overwrite).

**Rule:** when a CLI replaces a structured entry, default to `{...oldDep, ...newDep}` or an explicit allow-list of preserved fields. Destructive replacement requires a specific reason.

## Test-side learnings

- **Invariant assertions, not just feature assertions.** Broader assertions catch whole classes of regression.
- **Parametrized edge-case lists.** One test over `["./foo", "foo", "/foo", "foo/", "././foo", "foo//bar"]` would have collapsed three rounds into one.
