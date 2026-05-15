# Carbon Phase 1 — Retrospective

## What went well

- Schema additions were minimal: two optional fields on `LocalDependency`, nothing on remote variants. The "fields on the right variant, not the union" decision kept the type surface tidy.
- The visibility predicate landed as a 6-line function. Clean enough that "single source of truth" is genuinely true — no temptation to reimplement at the use site.
- Existing `validateDeps` loop absorbed the new check without restructuring. The new helper `validatePublishExclude` is invoked at the natural point.
- TDD red→green was clean: tests captured every requirement from PS3, PS4, PS6, PS7, PS27, PS28 before implementation.

## What was harder than expected

- Test file needed `as unknown as Record<string, unknown>` casts because TypeScript correctly rejected the direct cast from the narrowed `Dependency` union (the new optional fields aren't yet on most variants). Functional but slightly noisy. The alternative — adding the fields to the full union — would have polluted remote types with fields they should never carry. Trade chosen consciously.
- Biome formatter had opinions about line breaks in `errors.push(...)` that disagreed with manual layout. Resolved by running `biome check --write`.

## Learnings carried into next phases

- The `describeType(value)` helper duplicates the inline pattern at `parseScanConfig:70` and `parseSourceEntry:124`. Worth consolidating in a later cleanup pass — flagged for BACKLOG. Not a blocker.
- The visibility predicate signature `(entry, group)` requires the caller to know which group it's walking. Every Phase 2–5 site already does. If a future caller doesn't, the right move is a wrapper, not changing this signature.
- `publish: false` in `dev-dependencies` is allowed but redundant. Spec doesn't require a warning; if user confusion surfaces during real use, add a soft hint in `skilltree check` (Phase 5).

## Plan adjustments

None. Phases 2–5 remain as planned in `docs/planning/carbon/PLAN.md`.
