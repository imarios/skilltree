# Phase 2 — Short Memory

## What landed in `src/core/graph.ts`

- `ResolvedEntity.viaPack?: string` — set when a member was injected by a pack expansion. Never serialized.
- `ResolutionState` gained three fields: `packMemberOrigin`, `packMemberViaPack`, `packsReferencedByName`.
- `resolveOneRepo` is now idempotent (`if (state.repoResolutions.has(repo)) return;`).
- `resolveRepoVersions` now also collects `PackDependency.repo` so the containing repo is resolved in Phase 1.
- New flow in `resolveAll`: Phase 1 → `expandPackReferences` → Phase 1.5b (second `resolveRepoVersions` pass, idempotent) → `checkStaleTagManifests` → `processDeps`.
- `expandPackReferences`, `fetchPackMembers`, `injectPackMembers`, `deriveMemberKey`, `describeCollidingDep`, `warnUnreferencedPacks`, `shortRef` — all new helpers, ~150 LOC.
- `processDeps` consults `packMemberOrigin` / `packMemberViaPack` to substitute the right `declaredIn` and `viaPack` per resolved entity.
- `resolveEntity`, `resolveLocalEntity`, `resolveRemoteEntity` gained an optional `viaPack?: string` arg, set on the entity.

## Tests (`tests/core/graph-packs.test.ts`)

- Group H (local pack expansion happy path): H1, H2, H3, H4, H6.
- Group I (local pack errors): I1 missing, I2 consumer-dep collision, I3 two-pack collision, I4 unreferenced warning.
- Group J (remote pack happy path): J1 same-repo, J2 different-repo (Phase 1.5b second-pass coverage).
- Group K (remote pack errors): K1 no `packs:`, K2 missing pack, K3 absolute-local rejection.
- H5/J3 (source-aliased pack ref) deferred — covered indirectly by Phase 1's source-expansion tests + H2's mixed-member coverage. Not blocking.

## Things deferred (Phase 3 / Phase 4)

- `add --pack` CLI surface — Phase 3.
- `remove` guard for pack refs — Phase 3.
- Registry `kind: "pack"` extension + auto-detect via `IndexEntry` — Phase 3.
- E2E test that runs through `install` end-to-end — Phase 4.
- Docs (spec.md, reference.md, decisions.md, README, CHANGELOG) — Phase 4.

## Risks for Phase 3

- `add.ts` calls `canonicalSource` for overwrite detection (Phase 1 already extended `canonicalSource` for pack refs). The `checkOverwrite` flow should special-case pack refs to print "overwriting pack reference X" instead of diffing sources.
- `remove.ts` enumerates entities to remove; a pack ref has no entity. Need an `isPackDependency` guard early in the resolution to avoid spurious "not found" errors.
- `IndexEntry` schema change (`kind?: "entity" | "pack"`) is backward-compatible (optional field).

## Counts

- Test suite: 1540/1540 green (was 1526; +14 in this phase).
- tsc clean. biome clean on changed files.

## Files touched

- `src/core/graph.ts` — only file changed for behavior.
- `tests/core/graph-packs.test.ts` — new.
- `docs/planning/oxygen/PLAN.md` — Phase 2 marked complete.
- `docs/planning/oxygen/phase_2/DETAILED_PLAN.md` — new.
- `docs/planning/oxygen/phase_2/TEST_PLAN.md` — new.
- `docs/planning/oxygen/phase_2/SHORT_MEMORY.md` — this file.
- `docs/planning/oxygen/phase_2/RETRO.md` — to be written.
