# Carbon Phase 4 — Test Plan

## tests/core/graph-publish-downstream.test.ts

Fixture setup (mirrors existing graph-origin-manifest tests):
- Consumer manifest declares `analysis-pipeline` from origin repo.
- Origin manifest at HEAD declares `analysis-pipeline` in `dependencies` with `local: ./skills/analysis-pipeline` and `publish: true` (default).
- `analysis-pipeline`'s SKILL.md frontmatter declares dep `experimental-refactor`.
- Origin manifest also has `experimental-refactor` as local in `dependencies` BUT with `publish: false`.

### Tests

1. **Downstream resolution fails when transitive dep is publish:false.** Resolve consumer's manifest → error mentioning `experimental-refactor` is `publish: false` in origin (with origin repo URL). Error text differs from the dev-dep variant.
2. **Distinct from dev-dependency case.** Same fixture but origin moves `experimental-refactor` to `dev-dependencies` (and removes `publish: false`). Error mentions `dev-dependencies are not exposed` instead.
3. **Consumer's own manifest entry wins.** If consumer declares `experimental-refactor` directly in their own manifest, no error — consumer's declaration takes precedence over origin's `publish:false`.
4. **publish: true is silent.** Origin's `publish: true` (or omitted) entry → transitive resolution proceeds normally, no error.
