# Oxygen — Skill Packs

Project-Type: production
Sub-Project: Oxygen (started 05/19/2026)

Spec: [docs/specs/packs.md](../../specs/packs.md) (v1.0)

Introduces **packs** — named groups of dependencies declared in `skilltree.yml`, referenced by a single `PackDependency` entry. Same mechanism for local and remote packs; members are full dep entries (multi-repo); all-or-nothing for v1; door left open for nested packs.

## Project shape

Four sequential phases. Phase 1 lands the type + manifest layer (parser/validator/source expansion) so the rest of the codebase compiles against the new union. Phase 2 adds the resolver's new Phase 1.5 — the meat of the feature. Phase 3 wires the `add`/`remove` command surface and registry integration. Phase 4 ships docs, e2e tests, and a manual smoke against a real remote pack.

```
Phase 1: Types + Manifest          (parse/validate packs:, PackDependency, guards)
   │     src/types.ts, src/core/manifest.ts, src/core/deps.ts
   │     tests/core/manifest-packs.test.ts
   ↓
Phase 2: Resolver Phase 1.5        (expandPackReferences, injectMembers,
   │     idempotent resolveRepoVersions, packMemberOrigin attribution)
   │     src/core/graph.ts
   │     tests/core/graph-packs.test.ts
   ↓
Phase 3: Add / Remove / Registry   (--pack flag, local short-circuit, registry
   │     kind="pack", overwrite messaging, remove guard)
   │     src/commands/add.ts, src/commands/remove.ts, src/core/registry-scanner.ts
   │     tests/commands/add-pack.test.ts, tests/core/lockfile.test.ts (extend)
   ↓
Phase 4: Docs + E2E + Polish       (spec/reference/decisions updates, README,
         CHANGELOG, end-to-end test, manual smoke)
         docs/specs/*.md, README.md, CHANGELOG.md
         tests/e2e/packs.test.ts
```

Phases ship as separate PRs for clean review (per existing project convention). Each PR closes its phase and adds tasks to the next.

## Confirmed design decisions

1. **Name**: "pack" — short, distinct. `bundle` is already taken internally (`bundled-skill.ts` / `skilltree teach`).
2. **Definition location**: `packs:` section of `skilltree.yml`. Same shape locally and in remote repos. No new file type.
3. **Reference modes** (one mechanism):
   - **Remote**: consumer points at `repo` + `pack: <name>` + optional `version`. Versioned by repo git tag.
   - **Local**: consumer defines + references by `pack: <name>` only.
4. **Members are full dep entries** (`repo`/`source`/`local` + `path`/`version`/`name`/...) — not bare names. Multi-repo packs supported from v1.
5. **All-or-nothing for v1** — no consumer-side `exclude:` or per-member version override.
6. **v1 members are skill/agent/command only**; nested packs deferred but design leaves the door open (parse-time rejection only).
7. **Registries optional** — same model as skills. `IndexEntry.kind = "pack"` enables one-liner `skilltree add <name>` discovery, but not required.
8. **Pack is never an entity** — no `compositeKey`, no `state.entities` entry, no lockfile row, no installer work.

## Mental model (load-bearing)

A pack is purely a manifest-side construct. The resolver expands a `PackDependency` into N synthesized direct deps and then proceeds with the existing two-phase resolution unchanged. Pack members are first-class entities; the pack itself is just a list.

Blast radius: only the manifest layer, the resolver entry point, and `add`/`remove` learn about packs. The installer, lockfile schema, scanner, vendor, and doctor need zero changes.

## Phase 1: Types + Manifest (parse, validate, source-expand `packs:`) ✅ COMPLETE
<!-- Spec: packs.md R1, R8, R9, R11, R12 -->

Ship the type union and manifest-layer support so the rest of the codebase can compile against `PackDependency` and `PacksSection`. No resolver behavior yet; parsing alone produces a manifest with `packs:` populated and `PackDependency` entries in `dependencies:` typed correctly.

### Tasks
- [x] Add `PackDependency`, `PackMember`, `PacksSection` to `src/types.ts`; extend `Manifest` with optional `packs?: PacksSection`; add `isPackDependency` guard. (R1, R2)
- [x] **Tighten** existing `isRemoteDependency` / `isSourceDependency` so they exclude `PackDependency` (which can carry `repo`/`source`). Audit all call sites under `src/` before editing. (R9) — 3 type-soundness issues discovered + fixed (info.ts, registry-scanner.ts).
- [x] `src/core/manifest.ts`: add `parsePacksSection` + `parsePackMember`; wire from `parseManifest`. Reject nested-`pack:` members at parse time. (R1, R11, deferred-nested)
- [x] `src/core/manifest.ts`: extend `expandSources` to walk `packs[*][*]` members and to handle `source:` on top-level `PackDependency` entries. (R1, R4)
- [x] `src/core/manifest.ts`: extend `validateManifest` with the new validation rules (`PackDependency` mutex; forbidden fields; `packs.X` vs non-pack collision; member shape rules). (R8, R9)
- [x] `src/core/manifest.ts`: extend `validateGlobalManifest` to forbid `packs:` definition (references still allowed). (R12)
- [x] `src/core/deps.ts`: extend `canonicalSource` to handle `PackDependency` (factored into `canonicalPackSource` helper to keep complexity ≤ 25).
- [x] Tests: `tests/core/manifest-packs.test.ts` (44 cases) + `tests/core/deps-packs.test.ts` (7) + `tests/core/type-guards.test.ts` (4). 54 new cases total.

### Per-phase DoD additions
- [x] `tsc --noEmit` clean.
- [x] `bun test` green: 1526/1526 (was 1472; +54 new).
- [x] `bunx biome check` clean on all changed files.

## Phase 2: Resolver Phase 1.5 (pack expansion)
<!-- Spec: packs.md R3-R7 -->

Add the new resolver phase. Local and remote packs both work; pack-member collisions, missing packs, and absolute-local-in-remote-pack all produce typed errors. Pack-member entities carry `_viaPack` provenance and proper `declaredIn` attribution.

### Tasks
- [ ] `src/core/graph.ts`: make `resolveRepoVersions` idempotent (skip already-resolved repos).
- [ ] `src/core/graph.ts`: extend Phase 1 repo collection to include `PackDependency.repo` (so the containing repo is resolved up front).
- [ ] `src/core/graph.ts`: new `expandPackReferences(state)` — walks both groups, rewrites `state.expanded.dependencies` in place, deletes pack-ref keys, injects member entries. (R3, R4, R5, R7)
- [ ] `src/core/graph.ts`: new `injectMembers` — member-key derivation (`name` ?? `basename(path)` ?? `basename(local)`); collision detection; `_viaPack` provenance tag. (R6, R7)
- [ ] `src/core/graph.ts`: add `packMemberOrigin: Map<string, EntityOrigin>` side table on `ResolutionState`; thread through to `processDeps` → `resolveEntity` so `declaredIn` is correct for both local and remote pack members.
- [ ] `src/core/graph.ts`: add Phase 1.5b — second idempotent `resolveRepoVersions` pass to pick up new repos introduced by remote pack members.
- [ ] `src/core/graph.ts`: reuse `readOriginManifestAtRef` to fetch a remote pack's containing manifest at the resolved ref; reuse the existing `isRelativeLocalPath` check to reject absolute-local members of remote packs.
- [ ] `src/core/graph.ts`: emit non-blocking warning for locally-defined-but-unreferenced packs at end of `expandPackReferences`.
- [ ] Tests: `tests/core/graph-packs.test.ts` — covers all "Resolve (local)" and "Resolve (remote)" items from the spec testing checklist.

### Per-phase DoD additions
- [ ] Error attribution: every pack-related error names the manifest involved (consumer or `<repo>@<ref>`) per the Nitrogen Phase 4 convention.
- [ ] No installer/lockfile changes touched.
- [ ] `bun test` green (1382+ → still green; new resolver tests pass).

## Phase 3: Add / Remove / Registry
<!-- Spec: packs.md R10 -->

User-facing command surface. `skilltree add` learns three new code paths (local short-circuit, `--pack` flag, registry kind=pack). `remove` learns to skip entity-resolution for pack refs.

### Tasks
- [ ] `src/commands/add.ts`: local pack short-circuit — `add X` with no source flags and `packs.X` present locally → write `{ pack: X }`.
- [ ] `src/commands/add.ts`: `--pack` flag (boolean and `--pack <name>` for rename). Combine with `--repo`/`--source`/`--version`.
- [ ] `src/commands/add.ts`: `validateAddFlags` rejects `--pack` + `--path`, `--pack` + `--type`, `--pack` + `--local` with clear messages.
- [ ] `src/commands/add.ts`: `checkOverwrite` special-cases pack-ref overwrites — prints `overwriting pack reference "X"` instead of diffing sources.
- [ ] `src/core/registry-scanner.ts`: extend `IndexEntry` with optional `kind: "entity" | "pack"` (default "entity"); index `packs:` entries from each repo's manifest with `kind: "pack"`.
- [ ] `src/commands/add.ts` (`resolveFromRegistries`): when matched entry has `kind: "pack"`, build a `PackDependency` instead of a `RemoteDependency`.
- [ ] `src/commands/remove.ts`: add `isPackDependency` guard so removal of a pack ref doesn't try to find a corresponding entity.
- [ ] Tests: `tests/commands/add-pack.test.ts` — covers `add` items from spec testing checklist.
- [ ] Tests: extend `tests/core/lockfile.test.ts` with one assertion: lockfile from a pack-ref manifest contains only the expanded members, not the pack itself.

### Per-phase DoD additions
- [ ] Help snapshot regenerated; completion table updated.
- [ ] `bun test` green; tsc clean; biome clean.

## Phase 4: Docs + E2E + Polish
<!-- Spec: packs.md (all R) -->

Lock in the surface and provide a real end-to-end test against a fixture remote pack. Manual smoke against a real GitHub repo to confirm tag resolution.

### Tasks
- [ ] `docs/specs/spec.md`: new "Packs" section after dependency types.
- [ ] `docs/specs/reference.md`: `packs:` syntax, member shape, validation rules, errors.
- [ ] `docs/specs/decisions.md`: log Oxygen decisions — pack-as-list-not-entity; no overrides v1; member-key derivation rule; nested-packs deferred; bundle-name reserved.
- [ ] `docs/specs/registries.md`: `IndexEntry.kind` extension; pack discovery from `packs:` sections.
- [ ] `docs/specs/publication_surface.md`: note packs have no publish/exclude semantics (members keep their own).
- [ ] `README.md`: short "Packs" usage example.
- [ ] `CHANGELOG.md`: `feat:` entry.
- [ ] `tests/e2e/packs.test.ts`: end-to-end `init → add pack → install → verify files` for both local and remote packs.
- [ ] Manual smoke against a real GitHub repo: tag `v1.0.0`, add via `--pack --repo ... --version ^1.0.0`, verify install + lockfile.
- [ ] PROJECTS.md: move Oxygen to Completed when phase 4 ships.

### Per-phase DoD additions
- [ ] Spec testing checklist fully ticked.
- [ ] `BACKLOG.md` reviewed — anything discovered during work goes here or to a fresh GitHub issue.

## Project-level deliverables (across all phases)

- [ ] 4 PRs (one per phase), all green to main.
- [ ] Spec (`docs/specs/packs.md`) status flips `draft` → `active` after Phase 4 ships.
- [ ] Project retrospective at `docs/planning/oxygen/PROJECT_RETRO.md`.

## Oxygen — Sub-project Status

Phase 1: ✅ COMPLETE (05/19/2026)
Phase 2: ⏳ PENDING
Phase 3: ⏳ PENDING
Phase 4: ⏳ PENDING
