# Carbon Phase 2 — Detailed Plan

Spec: [publication_surface.md](../../../specs/publication_surface.md) §PS12–PS14, PS29

## Scope

Wire the visibility predicate into registry indexing. Add the `skilltree.yml`-as-index fallback tier between curated `skilltree-index.yml` and dynamic `git ls-tree` scan. Filter `publish: false` from generated indexes.

## Files touched

| File | Change |
|---|---|
| `src/core/registry-scanner.ts` | Add `manifestScanRepo(repoDir)` tier. Modify `scanRegistry` to try curated → manifest → dynamic. |
| `src/core/registry-cache.ts` | Bump `SCANNER_VERSION` from `1` to `2` (output semantics changed). |
| `src/commands/index-cmd.ts` | Filter `publish: false` paths when generating `skilltree-index.yml`. |
| `tests/core/registry-scanner-fallback.test.ts` | NEW. Three-tier ordering, manifest tier behavior, dynamic fallback. |
| `tests/commands/index-cmd-publish.test.ts` | NEW. `registry index` skips `publish:false`. |
| `docs/specs/registries.md` | Document the fallback chain. (PS29) |

## Design decisions

- **Tier 2 is authoritative when at least one visible local entry exists.** If `skilltree.yml` is present and has ≥1 local dep that passes `isPubliclyVisible`, emit those and stop. Don't merge with dynamic scan — the maintainer authored a manifest; trust it.
- **Tier 2 falls through if manifest has no visible local entries.** Covers the common case of a repo that consumes deps but doesn't author any (or only has `dev-dependencies` local entries). Dynamic scan picks up the conventional layout as before.
- **No tier-3 cross-filter.** Spec PS13's "tier 3 also filters via manifest" simplifies to "never needed in practice": if a manifest exists with local entries, tier 2 catches it; if it exists without local entries, there's nothing to filter; if no manifest exists, no signal to filter by. Drop this complexity from the spec implementation (will note in retro / spec refinement).
- **Description from frontmatter.** Tier 2 reads each declared path's SKILL.md (skills) or `<path>.md` (agents/commands) to pick up the `description:` frontmatter so emitted entries have parity with tiers 1 and 3.
- **Type inference.** If entry has `type:` use it. Else infer: path ending in `.md` → `mdFileType(path)`; otherwise skill.
- **Skip non-repo locals.** A `local:` pointing to `~/...` or `/...` is an author's local-source convenience, not part of THIS repo's publishable surface. Skip silently.
- **SCANNER_VERSION bump** invalidates every consumer's cached `index.json` so they refresh and pick up the new behavior. Standard pattern per the existing comment on the constant.

## Security pre-review

- Tier 2 reads `skilltree.yml` from an untrusted bare repo via `git show`. Content is parsed as YAML. The existing parser is strict; no new attack surface vs. tier 1 which does the same with `skilltree-index.yml`.
- No filesystem writes from tier 2.
- No new network calls.

## Phase-specific DoD

- All tests pass.
- `tsc` + biome clean.
- `SCANNER_VERSION` bumped; comment updated to reference Phase 2.
- `registry index` skips `publish:false` from generated output.
- `docs/specs/registries.md` updated with fallback chain.
