# Carbon Phase 3 — Retrospective

## What went well

- The gitignore-subset matcher landed in ~75 lines and handled the spec's example patterns plus a healthy parametrized table on first compile-error-free pass.
- The `CopyContext` shape kept the existing `copyEntityFiles` API understandable: one new param object grouping the three things the new logic needs.
- Vendor publish-filtering was a 5-line drop-in. The visibility data on `ResolvedEntity` made it trivial.
- The cleanup of duplicated normalize-path / hidden-path logic in Phase 2 paid off here — Phase 3 reused those concepts without writing parallel code.

## What was harder than expected

- **JSDoc + glob characters.** My initial JSDoc for `ignore.ts` used `**` and `*/` patterns inside backticks, which TypeScript's parser apparently treated as syntax tokens rather than docblock content (got "Expected ':' but found 'skills'" errors). Reworded the docblock to drop the problematic patterns. **Lesson:** never put `*/` inside a JSDoc, even in backticks.
- **Replace-chain ordering bug.** The `?` glob translation ran after inserting `(?:.*/)?` placeholder, which has its own `?` chars — they got mangled. Fixed by moving `?` translation to the front. Caught by tests.
- **Biome rejected `\x00`/`\x01`** as control characters in regex. Switched to `\u{1FFFE}`/`\u{1FFFF}` (Unicode non-characters) which are explicitly reserved and won't appear in real input.

## Learnings carried into next phases

- The `ResolvedEntity.publish` field is now part of the graph contract. Phase 4 (graph extension) and Phase 5 (`check` lint) both read it without needing to re-look up the manifest.
- Vendor's `dev-dependencies` semantics is fuzzier than the spec assumes — spec PS20 says "applies the visibility predicate" but vendor's intended behavior (per the comment at vendor.ts L75) is "ALL deps (both groups)". I narrowed to `publish: false` only. If the spec means strict predicate, dev-deps need to drop too — call it out for sir to decide.

## Plan adjustments

None for Phases 4 and 5. The strict-vs-permissive vendor question is a project-level open item, not a phase blocker.
