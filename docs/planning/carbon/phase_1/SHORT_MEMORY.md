# Carbon Phase 1 — Short Memory

## Stubs / new exports

- [x] `LocalDependency.publish?: boolean` — added to `src/types.ts`
- [x] `LocalDependency.exclude?: string[]` — added to `src/types.ts`
- [x] `isPubliclyVisible(entry, group)` — new in `src/core/visibility.ts`
- [x] `validateManifest` extension in `src/core/manifest.ts` (reject publish/exclude on remote; type-check)
- [x] `describeType(value)` — internal helper in `src/core/manifest.ts`, mirrors `parseScanConfig`'s pattern

## Notes

- Group parameter on `isPubliclyVisible` accepts `"dependencies" | "dev-dependencies"`. Existing callers walk these literals already; no helper needed to derive it.
- Validation error messages should start with the dependency group + key (matching existing pattern, e.g., `dependencies.foo: publish is only valid on local entries`).
- Round-trip works for free via YAML.stringify on the full object — no serializer change needed.
- Phase 1 changes no behavior. Existing tests must remain green untouched.
