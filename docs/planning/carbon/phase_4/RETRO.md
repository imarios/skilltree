# Carbon Phase 4 — Retrospective

## What went well

- The existing `originDevDepHints` mechanism was the right shape to extend. Renaming to `originHiddenHints` + widening the value type cost ~10 lines and made the new reason a clean addition rather than a parallel system.
- Detection in `tryResolveFromOriginManifest` slotted in next to the existing dev-dep branch with the same fall-through semantic.
- Error message follows the existing dev-dep template, so future readers (and the lint in Phase 5) can recognize the shape.

## What was harder than expected

- **Test fixture path.** First-draft tests put fixtures at conventional `skills/<name>` paths, which let the resolver's conventional probe rescue resolution even without the manifest tier. Took a debug round to realize the tier ordering — the hint only matters when no other tier resolves. Moved fixtures to `skills/source/<name>` (non-conventional). **Lesson:** when testing tier N, make sure tiers N+1..end can't satisfy the dep.

## Learnings carried into next phase

- The `publish: false` detection lives in `tryResolveFromOriginManifest`. Phase 5's `check` lint operates BEFORE resolution — it walks the local manifest and graph directly. The two predicates (consumer-facing-error vs maintainer-self-check) share the same source of truth (the `publish` field) but live in different code paths. Don't try to share code between them.

## Plan adjustments

None. Phase 5 (`check` lint) is next and final.
