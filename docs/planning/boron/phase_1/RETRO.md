# Phase 1 Retrospective

## What went well

- The resolver's R7 work (v1.1 of the spec) already established the `parseManifest` + `expandSources` + `readFileAtRef` pattern. Reusing it for R9 was straightforward.
- `inferTypeFromGit` took over once path was known, so R9 didn't need to care about skill-vs-agent discrimination.
- The 13-scenario TEST_PLAN caught the exact shape of every fallthrough case. No surprises during implementation.

## Harder than expected

- Two pre-existing tests asserted "missing path is a validation error" — the opposite of the new R12 contract. Had to update their assertions rather than delete, to keep coverage of the validator.
- `expandSourceDep` for local sources needed a path to build the absolute path. Added a targeted error there rather than try to infer for local-filesystem sources (they have no repo manifest to consult).

## Learnings

- When a spec requires loosening a validation rule, search for tests asserting the tight rule before touching code. Saves a red-green-red cycle.
- Defensive `hasDotDotSegment` check was cheap and kept the feature's security story honest.

## Plan adjustments

- None. Phases 2–4 proceed as scoped in PLAN.md.
