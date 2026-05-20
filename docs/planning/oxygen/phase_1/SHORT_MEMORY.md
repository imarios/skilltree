# Phase 1 — Short Memory

## What landed

- `src/types.ts`:
  - New `PackDependency` interface (`pack`, optional `repo`/`source`/`version`).
  - `PackMember = RemoteDependency | SourceDependency | LocalDependency` (v1 forbids `PackDependency` member at parse time).
  - `PacksSection = Record<string, PackMember[]>`.
  - `Manifest.packs?: PacksSection` added.
  - `isPackDependency` guard added.
  - `isRemoteDependency` / `isSourceDependency` tightened with `&& !("pack" in dep)` to exclude pack refs that carry repo/source.
- `src/core/manifest.ts`:
  - `parsePacksSection` + `parsePackMember` (parser strictness mirroring `parseSources` / `parseScanConfig`). Rejects nested-pack member with a forward-compat error message.
  - `expandSources` walks `packs:` members and top-level `PackDependency.source` refs.
  - `validatePackRef` enforces pack-ref shape (repo⊕source mutex; forbids path/type/name/local/force_path; requires repo/source when version is set).
  - `validatePacksSection` validates each member with the standard entity-dep rules, scoped under `packs.<name>[<i>]`. Flags pack-name vs non-pack-dep collisions.
  - `validateGlobalManifest` rejects defining packs in global (references still allowed).
- `src/core/deps.ts`:
  - `canonicalSource` extended with a pack branch via `canonicalPackSource` helper (kept top-level complexity ≤ 25 per biome).
- `src/commands/info.ts`:
  - `findInManifest` skips pack refs (info is for entities).
  - `printManifestSection` only prints `Type:` when the dep is not a pack ref.
- `src/core/registry-scanner.ts`:
  - `buildManifestEntry` param tightened from `Dependency & { local: string }` to `LocalDependency` (TS otherwise tried to admit `PackDependency & { local: string }` after guard tightening).

## Tests

- `tests/core/manifest-packs.test.ts` — Groups A (parse), B (PackDependency in deps), C (source expansion), D (validation), E (global validation). 47 cases.
- `tests/core/deps-packs.test.ts` — Group F (`canonicalSource` for packs). 7 cases.
- `tests/core/type-guards.test.ts` — Group G (guard tightening + `isPackDependency`). 4 cases.

Test count delta: 1472 → 1526 (+54), all green.

## Type-system fallout discovered

Tightening `isRemoteDependency` / `isSourceDependency` exposed three pre-existing type-soundness holes — fixed in this PR:

1. `info.ts:139,145` accessed `dep.name` on a raw `Dependency` (no narrowing). Pack refs have no `name`.
2. `info.ts:325` accessed `dep.type` after an `else if (isLocalDependency)` chain — pack refs would fall through.
3. `registry-scanner.ts:164` typed a param as `Dependency & { local: string }`, which after the guard tightening expanded to include `PackDependency & { local: string }` — TS surfaced the missing `name`.

All three are now compile-time impossible.

## What this phase does NOT do

- No resolver behavior — a manifest with a valid pack ref will parse and validate, but `skilltree install` won't expand it yet. That's Phase 2.
- No CLI surface — `skilltree add --pack` is Phase 3.
- No docs surface outside `docs/specs/packs.md` and `docs/planning/oxygen/` — README, CHANGELOG, and cross-spec updates land in Phase 4.

## Risk for Phase 2

The resolver (`src/core/graph.ts`) currently does not understand pack refs. After the guard tightening, a pack ref dep flows through neither `isRemoteDependency` nor `isLocalDependency` and will likely hit the "unknown dep shape" path. Phase 2's first task should be to add the early `isPackDependency` branch + `expandPackReferences` so this is handled correctly. Until Phase 2 lands, no one should write a pack ref in their manifest.

## Files touched

```
src/types.ts
src/core/deps.ts
src/core/manifest.ts
src/core/registry-scanner.ts
src/commands/info.ts
tests/core/deps-packs.test.ts          (new)
tests/core/manifest-packs.test.ts      (new)
tests/core/type-guards.test.ts         (new)
docs/specs/packs.md                    (new spec)
docs/planning/oxygen/PLAN.md           (new)
docs/planning/oxygen/phase_1/TEST_PLAN.md (new)
docs/planning/oxygen/phase_1/SHORT_MEMORY.md (this file)
docs/PROJECTS.md                       (added Oxygen)
```
