# Carbon Phase 3 — Short Memory

## New exports

- [x] `IgnoreMatcher` class in `src/core/ignore.ts` — gitignore-subset matcher
- [x] `ResolvedEntity.publish?: boolean` — threaded from local manifest entry
- [x] `ResolvedEntity.exclude?: string[]` — threaded from local manifest entry

## Internal changes

- [x] `executeInstall` reads `.skilltreeignore` once per call (cheap; one fs call), builds combined matcher per entity
- [x] `copyEntityFiles` accepts `CopyContext` with projectDir + entity matcher + repo matcher
- [x] `shouldExclude(src, sourcePath, ctx)` — checks both matchers, never matches the entity root itself (would skip the whole copy)
- [x] `vendorCommand` filters `publish:false` locals via `filterUnpublishedLocals`

## Notes

- Used `\u{1FFFE}` / `\u{1FFFF}` (non-character code points) as placeholders in the glob → regex translation, after biome rejected `\x00`/`\x01`. These are reserved non-characters per Unicode, guaranteed never to appear in valid text.
- `exclude:` is a no-op on agent/command (single-file) entities — documented in `copyEntityFiles`. No user-visible error if set.
- Vendor's strict-spec interpretation (PS20: "applies the visibility predicate") would also drop dev-dependencies. Chose to preserve today's behavior (vendor includes dev-deps) and only filter publish:false. Flagged as open question.
- Test `vendor-publish.test.ts` includes a slightly awkward fallback for creating the `experiments/` dir (writeFile with catch → mkdir) — could clean up later.
