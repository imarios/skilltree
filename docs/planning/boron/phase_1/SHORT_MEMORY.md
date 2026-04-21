# Phase 1 Short Memory

## Stubs

- [x] `inferDirectDepPath(entityName, consumerRepo, resolution, state)` in `src/core/graph.ts` — returns string path or null
- [x] `resolveRemoteEntity` — branch for missing `dep.path`, calls helper, emits R9 error inline
- [x] Safety guard: `hasDotDotSegment` rejects inferred paths with `..`
- [x] `validateManifest` — removed "path required" check for remote deps
- [x] Two pre-existing tests updated to reflect R12 new contract

## Notes

- `SourceDependency` gets its `path:` stripped during `expandSources`, but `expandSourceDep` in `manifest.ts` assumes `dep.path` is present (line `dep.path === "."`). Must handle missing path there too (pass-through, let resolver infer).
- `LockfileEntry.path` stays required — we always record what was resolved.
- When inferring for `source:`-expanded deps, the expansion already sets `repo:` — by the time we reach `resolveRemoteEntity`, we have `dep.repo` populated. Good.
- `force_path` is added to schema in this phase but not consumed until Phase 2.
