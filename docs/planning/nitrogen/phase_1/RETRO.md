# Phase 1 — Retrospective

Date: 2026-05-17
Status: ✅ COMPLETE
Test gate: 1347/1347 green (was 1337; +10 from this phase).

## What went well

- **Most of the work was already done.** `validateManifest`, `diffManifestLockfile`, `lintAsymmetricPublish`, and `lintLocalFrontmatter` were already pure functions. Phase 1 only had to extract one orchestration wrapper (`collectCheckIssues`) and add one non-throwing helper (`resolveTargets`). Net diff: ~80 lines of source + 130 lines of tests.
- **TDD red→green held cleanly.** First test run produced two expected failures from missing exports (good red signal — typo'd export names would have surfaced here too). Second iteration fixed a literal-path detection bug in `resolveTargets` (I conflated "resolved path differs from input" with "input is a literal path"). Test caught it.
- **Regression guard worked.** The pre-count of 47 check-related tests held exactly after extraction. Output behavior of `skilltree check` is byte-identical.

## What was harder than expected

- **`resolveTargets` literal-path detection.** First implementation used `target !== resolvedPath` as a proxy for "input is a literal path." That's wrong for bare agent words like `"claude"` where input (`"claude"`) and resolved (`".claude"`) differ but the input is *not* a literal path. Fix: use the existing `isLocalSource(target)` predicate. Lesson: **use the canonical helper instead of re-deriving the predicate** — this is exactly the "canonical-identity helper" pattern called out in CLAUDE.md.

## Plan adjustments for upcoming phases

- **Phase 2 file location**: leave `resolveTargets` in `src/commands/targets.ts`. Originally I planned to move it to `src/core/` in Phase 2 — but the function is only ~30 lines and doctor can import it from the command module without ceremony. Save the move for if/when a third consumer shows up.
- **`CheckResult` type** lives in `src/types.ts` and is ready for Phase 2's doctor orchestrator to populate. No type changes anticipated.

## Hardening notes

- Manual hypothesis pass run in place of `/code-refinement-with-hypothesis` (slash command not callable from this context). Six hypotheses checked, all clean:
  H1 duplicate targets (correct as-is), H2 empty resolveTarget (impossible), H3 empty input (handled), H4 concurrency (no shared state), H5 symlinks (follow is correct), H6 `expandTilde` on literal path (correct).
- P0 security review: no auth surface, no new exec/spawn, no secrets. Pure data refactor + one read-only `fs.stat`.

## Carry-forward to Phase 2

- `collectCheckIssues(manifest, dir): CheckSummary` is the function doctor's D6 check will call.
- `resolveTargets(targets): TargetResolution[]` is the function doctor's D8 check will call.
- `validateManifest(manifest): string[]` (existing) is what D5 will call — doctor should NOT use `validateManifestOrThrow` because doctor wants to keep running on a fail rather than crash.
- `diffManifestLockfile(manifest, lockfile): LockfileDiff` (existing) is what D7 will call — paired with `readLockfile(dir): Promise<Lockfile | null>` (existing) for loading.
