# Phase 5 Retrospective

## What went well

- Extracting `canonicalPath` from `normalizePathForCompare` was a pure refactor — tests carried over cleanly. Parametrized edge-case table let the whole pattern-A concern live in one place.
- `canonicalSource` moved to its own file; `add.ts` became noticeably easier to read once that 30+ line helper was hoisted out.
- `preserveOrthogonalFields` replaced the ad-hoc `force_path`-only preservation with a generalized list. Adding a new user-authorable orthogonal field now is a single-word append to `PRESERVED_FIELDS`.
- CLAUDE.md "Code conventions" section turns three pattern-lessons from the review into guardrails future code has to actively ignore, not accidentally miss.
- The codebase audit turned up zero additional semantic path-equality sites needing the canonical helper — a sign that the patterns were really only live in the two hotspots we knew about. Minimal surface for drift.

## Harder than expected

- `canonicalPath("/./skills/foo")` broke the first test run — the initial regex stripped leading `./` then leading `/` in two separate passes, which can't handle `/./` in one go. Collapsing to `^(?:\.\/|\/)+` handled it. Added a test for `.claude/foo` (a legitimate leading-dot directory) to lock in that the regex doesn't get greedy about single-dot directory names.

## Harder than expected, pt 2

- Type-checking `preserveOrthogonalFields` across the `Dependency` union required a couple of `Record<string, unknown>` casts. Worth noting that the union is currently ergonomic to read but awkward to refactor across — consider branded types or discriminator fields in future cleanup.

## Learnings

- **Test helpers benefit more from canonical functions than production code does.** The production code had two call sites that needed consistent normalization; the test suite now has one place to add new path-equivalence cases. The leverage ratio for this kind of extraction is higher than first appearance.
- **CLAUDE.md conventions are cheap to write and expensive to miss.** Three of the seven issues the review found were variants of the same patterns. A single-paragraph convention in CLAUDE.md on each is a tiny cost for a whole class of future reviews.

## Architectural concerns deferred

- **Repo URL canonicalization.** `entry.repo === consumerRepo` in graph.ts compares strings verbatim. `github.com/x/y` vs `github.com/x/y/` vs `https://github.com/x/y.git` would miscompare. Not motivated by a current bug but probably worth a helper when it is.
- **Dependency union ergonomics.** Refactoring across `LocalDependency | RemoteDependency | SourceDependency` is awkward. A branded / discriminator refactor would help — but touches types.ts and a lot of callers, so it's a separate project.

## Plan adjustments

None. Boron is complete.
