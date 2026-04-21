# Phase 2 Retrospective

## What went well

- `detectPathMismatch` is a direct structural twin of `inferDirectDepPath`. Same manifest read, same entry extraction, same `..`-segment guard. Reviewers should find this symmetry easy to reason about.
- The 8 R10 scenarios captured every branch of the warning logic on the first pass.
- Existing `result.warnings` channel required zero new plumbing — just `.push(...)`.

## Harder than expected

- Test 3 (override warning) required two skills at different paths in the fixture repo so the consumer's override actually resolves after emitting the warning. Adjusted the fixture inline — no helper change needed.
- Side-quest audit: S1 already covered, S2 was new. Added to same file rather than dispersing.

## Learnings

- Comparison-only logic ("does X match Y?") benefits from keeping its manifest read separate from the inference path. Tempting to share code but the semantics diverge (inference has fallthrough, comparison has no-match-returns-null), and coupling them would hurt readability.

## Plan adjustments

- None.
