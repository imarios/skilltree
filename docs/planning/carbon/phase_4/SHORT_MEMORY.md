# Carbon Phase 4 — Short Memory

## Changes

- [x] `ResolutionState.originDevDepHints` → `originHiddenHints` (renamed, widened type)
- [x] New `OriginHiddenHint = { repo, reason: "dev-dependency" | "publish-false" }`
- [x] `tryResolveFromOriginManifest`: detect `isLocalDependency(prodEntry) && prodEntry.publish === false`, record hint with reason `"publish-false"`, return false
- [x] `addUnresolvedError`: render distinct message per reason; preserves existing dev-dep wording for regression-safety
- [x] `docs/specs/reference.md`: updated origin-manifest section to mention `publish: false`

## Notes

- Detection point fires BEFORE the `isLocalDependency` resolve branch — so a `publish: false` entry never resolves through origin-manifest lookup. Conventional probe is still tried after (correct: if consumer's manifest has its own copy or the path matches a convention, that's fine).
- Test 2 (dev-dep regression) used to pass even on red — because origin's `experimental-refactor` was at conventional `skills/experimental-refactor`, the probe rescued resolution. Moving the path to `skills/source/experimental-refactor` (non-conventional) is what makes the test actually exercise the hint path.
- Renaming the internal field had no external API impact (it's `private` state on `ResolutionState`).
