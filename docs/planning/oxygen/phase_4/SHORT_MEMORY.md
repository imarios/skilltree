# Phase 4 — Short Memory

## What landed

### E2E test
- `tests/e2e/packs-e2e.test.ts` — 2 cases. Both run the full `installCommand` path:
  - Local pack with 3 remote members → verifies all 3 skills materialized + lockfile contains them but NOT the pack.
  - Remote pack defined in repo A, members in repo B → verifies Phase 1.5b's idempotent second-pass repo resolution works end-to-end.

### Docs
- `docs/specs/packs.md`: status `draft` → `active`. Changelog entry updated.
- `docs/specs/spec.md`: new "Packs" subsection under Core Concepts.
- `docs/specs/reference.md`: full `packs:` syntax + `PackDependency` shape + validation rules + error matrix.
- `docs/specs/decisions.md`: Decision #17 — packs are manifest-side only, never entities.
- `docs/specs/registries.md`: `IndexEntry.kind` extension documented (tier 2 of the indexing fallback chain now emits packs).
- `docs/specs/publication_surface.md`: new "Packs (Oxygen)" section explaining packs have no publish/exclude semantics.
- `README.md`: "Packs — Named Groups of Dependencies" with local + remote examples and CLI usage.

### CHANGELOG
- Not manually edited. Commitizen reads conventional commits and generates the next version's changelog on `cz bump`. The four Oxygen commits (`feat(packs):` ×4) will produce a clean changelog block when released.

## Things deferred / out of scope

- **Manual smoke against a real GitHub repo.** The e2e tests use `file://` fixture repos, which exercise every code path the production resolver touches. A live network test only validates GitHub's response, not skilltree's logic. Run post-merge if desired but not blocking.
- **`skilltree why <pack>`** — out of scope for Oxygen. v1 supports `why <member>` via the `viaPack` field.
- **Nested packs.** Parse-time guard remains; the structural type permits members of any shape. v2 lifts the guard + wraps `expandPackReferences` in a convergence loop.

## Counts

- Test suite: 1558/1558 green (was 1556; +2 e2e cases).
- tsc clean. biome clean.

## Files touched

- `tests/e2e/packs-e2e.test.ts` (new)
- `docs/specs/packs.md` (status active)
- `docs/specs/spec.md`
- `docs/specs/reference.md`
- `docs/specs/decisions.md`
- `docs/specs/registries.md`
- `docs/specs/publication_surface.md`
- `README.md`
- `docs/planning/oxygen/PLAN.md`
- `docs/planning/oxygen/phase_4/{SHORT_MEMORY,RETRO}.md` (new)

## Cumulative Oxygen tally (all 4 phases)

| Phase | Tests added | Commits | Files (production code) |
|---|---|---|---|
| 1 (types + manifest) | 54 | 1 | types.ts, manifest.ts, deps.ts (+ guard-tightening fallout in info.ts, registry-scanner.ts) |
| 2 (resolver Phase 1.5) | 14 | 1 | graph.ts |
| 3 (add/remove/registry) | 16 | 1 | add.ts, registry-scanner.ts, types.ts, cli.ts, completion.ts |
| 4 (docs + e2e) | 2 | (this commit) | (docs only) |
| **Total** | **86 new tests** | 4 | resolver + manifest + add + registry, all green |
