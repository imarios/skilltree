# Phase 1 — Retrospective

## What went well

- **Plan stability.** The spec + PLAN.md written at the start of the session held through implementation. No re-scoping mid-phase.
- **TDD red→green was clean.** 38 fails at the red stage, all on intended assertions. No tests had to be rewritten to match implementation; the implementation matched the tests.
- **Type-system caught real fallout.** Tightening `isRemoteDependency` / `isSourceDependency` to exclude `PackDependency` surfaced three pre-existing soundness holes (`info.ts:139,145,325` and `registry-scanner.ts:164`). Each was a real risk of NPE-style behavior if a pack ref ever appeared in those code paths — the compiler made them impossible at build time.
- **Cognitive-complexity warning was actionable.** Biome's complexity check on `canonicalSource` (30 vs 25) pushed an extract-helper refactor that read cleaner anyway.

## What surprised us

- **Biome had a pre-existing config snag** in a worktree directory unrelated to this work — full-repo `biome check` errors out. Worked around by scoping to the changed file set. Worth a separate cleanup PR.
- **`Dependency & { local: string }` did not narrow as expected** after the guard tightening. The intersection still permits `PackDependency & { local: string }` (an impossible runtime shape but a valid TS type). Fix was to type the parameter as `LocalDependency` directly instead of relying on intersection narrowing. Carrying this pattern into Phase 2's resolver work.

## What to carry into Phase 2

- The resolver does not yet handle `PackDependency` — a pack ref flowing into `processDeps` will fall through both `isRemoteDependency` and `isLocalDependency` checks. **Phase 2's first task** must be the early `isPackDependency` branch in `expandPackReferences`, before any other resolver work.
- The `packMemberOrigin` side table on `ResolutionState` is the cleanest threading path for `declaredIn` attribution — confirmed by re-reading graph.ts during planning.
- Make `resolveRepoVersions` idempotent (early-return for already-resolved repos) before adding Phase 1.5b. This is mentioned in PLAN but easy to forget.

## What we should NOT carry forward

- Any temptation to "also handle the resolver while I'm here" was correctly resisted. The 4-phase split keeps each PR reviewable.

## Process notes

- Methodology cycles 010–100 worked as intended. The `TEST_PLAN.md` artifact (Group A/B/C/D/E/F/G) was particularly valuable — it gave a single sheet to check against during both test-writing and post-implementation review.
- The plan file written before invoking the methodology mapped almost 1:1 to PLAN.md sections; minimal duplication.
