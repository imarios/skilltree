# Phase 2 Short Memory

## Stubs

- [ ] `detectPathMismatch(entityName, consumerPath, consumerRepo, resolution)` — reads origin manifest, compares path, returns `{kind: "redundant"|"override", originPath: string}` or null
- [ ] `formatPathWarning(kind, entityName, consumerPath, originPath, originRepo)` — string formatter
- [ ] `resolveRemoteEntity` — call detect + push warning when `dep.path` present and `force_path !== true`
- [ ] Side-quest audit: confirm S1 (bad source alias) has coverage; add S2 test

## Notes

- `detectPathMismatch` and `inferDirectDepPath` both read origin's manifest. Consider inlining or caching — but origin manifest reads are small and already cached by git. Defer optimization.
- The comparison should use `stripDotSlash` on origin's `local:` to normalize against consumer's `path:` which is typically bare (no `./`).
- `hasDotDotSegment` protection for R10 too — if origin's declared path has `..`, we don't compare (treat as no-declaration).
