# Phase 5 Detailed Plan — Systemic Hardening

**Source:** `phase_5/REVIEW_NOTES.md` — patterns distilled from the 5-round hypothesis-driven review.

## Goal

Turn the review's pattern-level findings into guardrails: one canonical-path helper, one canonical-source helper, a preserve-mode overwrite idiom, and a "Code conventions" section in `CLAUDE.md`. Prevent the same class of issue from recurring.

## Scope

**In scope:**
- Extract `canonicalPath` in `src/core/paths.ts` (from `normalizePathForCompare` in `graph.ts`). Export with a documented contract.
- Extract `canonicalSource` in `src/core/deps.ts` (new file; from `describeSource` in `add.ts`). Export.
- Preserve-mode in `addCommand`: use the existing in-memory `deps[name]` as the base for overwrites; CLI-built dep overrides named fields only.
- Audit: route semantic path/source comparisons through the helpers.
- `CLAUDE.md` section: "Code conventions — hardening patterns."
- Tests: parametrized path-equality coverage + canonical-source cases + broader invariant assertion on overwrite.

**Deferred:**
- Rewriting the resolver to store canonical paths (would touch lockfile format — separate project).
- URL canonicalization (repo URL variations with/without trailing `/`, `.git` suffix) — not a current issue.

## Files Touched

| File | Change |
|------|--------|
| `src/core/paths.ts` | Add `canonicalPath(p)` with JSDoc contract. Keep `stripDotSlash` (other callers). |
| `src/core/deps.ts` | **New.** Export `canonicalSource(dep, sources?)`. |
| `src/core/graph.ts` | Replace local `normalizePathForCompare` with import of `canonicalPath`. |
| `src/commands/add.ts` | Replace local `describeSource` with import of `canonicalSource`. Switch the overwrite path to preserve-mode via `{...existing, ...dep}` (then assign back). |
| `CLAUDE.md` | Add "Code conventions" section. |
| `tests/core/paths.test.ts` | Parametrized path-equality test covering the reviewed edge cases. |
| `tests/core/deps.test.ts` | **New.** `canonicalSource` unit tests. |
| `tests/commands/add.test.ts` | Add an "overwrite preserves unknown fields" test (broader invariant). |

## Security Pre-Review

- Pure-function extractions; no new I/O, no new trust boundaries.
- Preserve-mode spread could, in principle, keep a stale `local:` alongside a new `repo:`, violating mutex. Mitigation: preserve-mode applies AFTER the new dep is built, and we overwrite via field-level assignment rather than shallow merge where mutex fields are involved. Verify by test.

## Phase-specific DoD

- `canonicalPath` and `canonicalSource` are the single callsite for their respective comparisons in the codebase (audit confirms).
- All existing tests green; new tests green.
- `CLAUDE.md` convention section covers the three patterns + preserve-mode.
