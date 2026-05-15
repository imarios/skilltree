# Carbon Phase 2 — Short Memory

## Exports / new public API

- [x] `manifestScanRepo(repoDir)` — tier 2 entry point (public).
- [x] `hiddenPathsFromManifest(manifest)` — shared helper, also consumed by `index-cmd`.
- [x] `SCANNER_VERSION` bumped 1 → 2 (registry-cache.ts).

## Internal helpers

- [x] `manifestEntriesFromManifest(repoDir, manifest)` — emit IndexEntries from parsed manifest.
- [x] `readManifestAtRef(repoDir)` — git-show + parseManifest, tries `.yml` then `.yaml`.
- [x] `normalizeLocalPath(local)` — strip leading `./`, reject absolute and `~` paths.
- [x] `buildManifestEntry` — derive name/type/path + description-from-frontmatter.
- [x] `inferEntityType` — `entry.type ?? (mdFileType(path) for .md) ?? "skill"`.

## Notes

- Tier 3 (dynamic scan) now cross-filters via the same manifest-derived hidden-path set used by `index-cmd`. Spec PS13 is fully honored in code, not just spirit.
- The hidden-path helper was promoted from `index-cmd` to `registry-scanner` so both code paths share one rule. Single source of truth.
- Description for tier 2 is best-effort: if frontmatter unreadable or path missing, emit the entry without description rather than dropping it. Matches how `dynamicScanRepo` handles the same failure.
- Path normalization is duplicated in `registry-scanner.ts` and `manifest.ts`-adjacent code — minor; consolidating would be a clarity-only refactor.
