# Phase 3 Detailed Plan — CLI `--path` Optional

**Spec ref:** [origin_manifest_resolution.md](../../../specs/origin_manifest_resolution.md) §R13

## Goal

`skilltree add --repo <url>` (or `--source <alias>`) accepts an omitted `--path`. Manifest entry is written without `path:`; resolver infers at install time.

## Files Touched

| File | Change |
|------|--------|
| `src/commands/add.ts` | `buildDependency`: remove "require --path" throw for remote/source. Write entry without `path:` when not provided. |
| `tests/commands/add.test.ts` | Replace old "errors when missing --path" test with two R13 tests: one for `--repo` without `--path`, one for `--source` without `--path`. |

## Security Pre-Review

None. No network or file access changes beyond what's already there.

## Phase-specific DoD

- R13 tests pass.
- Full test suite green.
