# Phase 2 Detailed Plan — Redundancy & Override Warnings

**Spec ref:** [origin_manifest_resolution.md](../../../specs/origin_manifest_resolution.md) §R10, R11

## Goal

When consumer supplies an explicit `path:` and origin's manifest declares the same name under `dependencies:`, emit a warning:

- **Redundant:** consumer's `path:` == origin's declared path → "You can omit `path:`".
- **Override:** consumer's `path:` != origin's declared path → "You're overriding origin. Use `force_path: true` to silence."

`force_path: true` silences both warnings.

## Scope

- New helper in `src/core/graph.ts`: `detectPathMismatch(entityName, consumerPath, consumerRepo, resolution)` returning `"redundant" | "override" | null` plus `originPath` for message formatting.
- Wire into `resolveRemoteEntity` after path is known (whether provided or inferred). Skip entirely when `dep.force_path === true`.
- Warnings join `state.warnings`; install output already surfaces these.
- Tests: 8 R10 scenarios + side-quest audit tests.

## Files Touched

| File | Change |
|------|--------|
| `src/core/graph.ts` | Add `detectPathMismatch` helper; call from `resolveRemoteEntity` when `dep.path` is present and `force_path` is not true. |
| `tests/core/graph-path-warnings.test.ts` | New test file, 8+ scenarios. |

## Security Pre-Review

- Warnings read origin's manifest — same trust boundary as R9. No new surface.
- Warning strings include the origin repo URL and both paths. All already-trusted inputs (from the manifest).

## Phase-specific DoD

- All R10 tests pass.
- Full test suite green.
- Side-quest audit: grep existing tests for `source:` / `path:` gap coverage. Add missing tests in same file.

## Side-quest audit plan

Existing coverage to verify:
1. Undefined `source:` alias — should error at `expandSourceDep`. Grep for test.
2. Explicit `path:` pointing at non-existent location at resolved tag — already covered by `missing-remote-path.test.ts`?
3. `source:` expanding to URL but path missing + origin doesn't help → new R9 error. May need new test.

If gaps: add one test each.
