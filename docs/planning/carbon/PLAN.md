# Carbon — Publication Surface

Project-Type: production
Sub-Project: Carbon (started 05/14/2026)

Spec: [docs/specs/publication_surface.md](../../specs/publication_surface.md) (v1.0)

Resolves issue #63 (closes on merge of final phase). Builds on Lithium (registries / `skilltree-index.yml`) and Boron (origin-manifest resolution).

## Project shape

One cohesive feature with five layered phases. Phase 1 lays the foundation (types + validation + the visibility predicate helper) without wiring it up yet — every subsequent phase plugs into that predicate at a specific consumer-facing path.

```
Phase 1: foundation
  types + validateManifest + visibility predicate helper
       │
       ├──→ Phase 2: registry-scanner fallback + index filtering
       │
       ├──→ Phase 3: installer + vendor exclude / .skilltreeignore
       │
       ├──→ Phase 4: graph extension for downstream visibility
       │
       └──→ Phase 5: check lint for asymmetric publish state
```

After Phase 1 ships, Phases 2–5 are mostly independent and could be parallelized in principle, but we ship them sequentially for clean per-phase commits and reviewable diffs.

## Phase 1: Foundation — types, validation, visibility predicate ✅ COMPLETE
<!-- Spec: publication_surface.md PS1–PS5, PS27–PS28 -->

Lay the foundation: schema fields, validation, and one helper that every subsequent phase calls. No use sites are wired up yet — Phase 1 produces dead code that gets activated in Phases 2–5.

### Tasks
- [x] Add `publish?: boolean` and `exclude?: string[]` to `LocalDependency` in `src/types.ts`. (PS3, PS6)
- [x] `parseManifest` / `serializeManifest` in `src/core/manifest.ts`: round-trip the two new fields (verified by tests; no code change needed — YAML pass-through preserves them).
- [x] `validateManifest`: reject `publish:` or `exclude:` on remote entries. Type-check `publish` is boolean and `exclude` is `string[]`. (PS4, PS7, PS27, PS28)
- [x] New file `src/core/visibility.ts` with `isPubliclyVisible(entry, group)`. Single source of truth. (PS1, PS2)
- [x] Tests (`tests/core/manifest-publish-exclude.test.ts`): 17 cases — round-trip, remote-entry rejection, type errors, positive cases.
- [x] Tests (`tests/core/visibility.test.ts`): 9 cases — full predicate table across all dep variants and groups.
- [x] `bun test` green: 1129/1129. `tsc` and biome clean.

## Phase 2: Registry-scanner fallback + index filtering ✅ COMPLETE
<!-- Spec: publication_surface.md PS12–PS14 -->

Wire the visibility predicate into registry indexing and add the `skilltree.yml`-as-index fallback tier.

### Tasks
- [x] `src/core/registry-scanner.ts`: insert tier 2 (manifest-derived) between curated `skilltree-index.yml` and the dynamic `git ls-tree` scan. (PS12, PS13)
- [x] Tier 3 (dynamic-scan) cross-filters via `hiddenPathsFromManifest` so paths the manifest marks hidden never surface even when SKILL.md exists on disk.
- [x] `src/commands/index-cmd.ts`: filter `publish:false` (and dev-dep local) paths when generating `skilltree-index.yml`. (PS14)
- [x] `SCANNER_VERSION` bumped 1 → 2 so existing consumers refresh their caches.
- [x] Tests (`tests/core/registry-scanner-fallback.test.ts`): 14 cases — three-tier ordering, manifest tier behavior, cross-filter.
- [x] Tests (`tests/commands/index-cmd-publish.test.ts`): 4 cases — `publish:false`, dev-deps, no-manifest, undeclared-skill.
- [x] Updated `docs/specs/registries.md` with the fallback-chain section. (PS29)
- [x] `bun test` green: 1147/1147. tsc + biome clean.

## Phase 3: Installer + vendor — exclude and .skilltreeignore ✅ COMPLETE
<!-- Spec: publication_surface.md PS6–PS11, PS17, PS20–PS22 -->

File-level trim. Introduces a glob-based ignore engine and wires it into both installer and vendor copy paths.

### Tasks
- [x] New file `src/core/ignore.ts`: `IgnoreMatcher` class, gitignore-subset semantics (literal, `*`, `**`, `**/`, `?`, root anchor, trailing-slash dir). (PS9, PS11)
- [x] `src/core/installer.ts`: reads `.skilltreeignore` once per `executeInstall`. `copyEntityFiles` honors entity-relative `exclude:` + repo-relative `.skilltreeignore`. (PS17)
- [x] `src/core/graph.ts`: `ResolvedEntity` gains `publish` and `exclude`, threaded from `LocalDependency`.
- [x] `src/commands/vendor.ts`: filters `publish:false` local entities via `filterUnpublishedLocals` before planning. Exclude/ignore-file honored via the installer path. (PS20, PS21)
- [x] Tests (`tests/core/ignore.test.ts`): 28 cases — parametrized table over pattern × path.
- [x] Tests (`tests/core/installer-exclude.test.ts`): 5 cases — exclude, .skilltreeignore, layered, no-matchers.
- [x] Tests (`tests/commands/vendor-publish.test.ts`): 3 cases — publish:false skipped, dev-deps preserved, exclude honored.
- [x] Vendor audit: today's vendor copies BOTH groups; Phase 3 preserves that and only filters `publish:false`. Strict spec PS20 reading ("applies the visibility predicate") is noted as an open question.
- [x] `bun test` green: 1183/1183. tsc + biome clean.

## Phase 4: Graph extension — downstream visibility error ✅ COMPLETE
<!-- Spec: publication_surface.md PS15–PS16 -->

Extend origin-manifest lookup so a downstream chain hitting a `publish:false` entry produces the same actionable error already used for `dev-dependencies`.

### Tasks
- [x] `src/core/graph.ts`: renamed `originDevDepHints` → `originHiddenHints`, value type widened to `{ repo, reason }`. (PS15)
- [x] Detection: when origin's `dependencies[name]` is a local entry with `publish: false`, record hint with reason `"publish-false"` and fall through.
- [x] Error formatting: `addUnresolvedError` renders distinct text per reason; preserves dev-dep wording for regression-safety. (PS16)
- [x] Tests (`tests/core/graph-publish-downstream.test.ts`): 4 cases — publish:false error, dev-dep regression, consumer override, publish:true silence.
- [x] Updated `docs/specs/reference.md` origin-manifest section. (PS31)
- [x] `bun test` green: 1187/1187. tsc + biome clean.

## Phase 5: `check` lint — asymmetric publish state ✅ COMPLETE
<!-- Spec: publication_surface.md PS23–PS26 -->

Catch the footgun: a published entity transitively depends on a same-repo `publish:false` entity. The maintainer's local install succeeds, but downstream consumers fail at install time.

### Tasks
- [x] `src/commands/check.ts`: NEW `checkCommand` + `lintAsymmetricPublish` BFS. Per spec PS23/PS25 walks only same-repo local entities.
- [x] Error formatting: indented chain (`a (published) → b (published) → c (publish: false)`) with leak marker. (PS24)
- [x] `--strict` flag exits 1 if any warnings. (PS26)
- [x] CLI registration + completion table + commands.md updated.
- [x] Tests (`tests/commands/check-publish.test.ts`): 10 cases — direct, transitive (2-hop, 3-hop), multi-chain, clean, all-false, remote-edges, dev-group, render-format, cycle-safety.
- [x] Updated `README.md` "Publication Surface" subsection. (PS32)
- [x] Updated `docs/specs/spec.md` "Dependencies: Remote vs Local" with publication-surface flags. (PS30)
- [x] Help snapshot, completion freshness, and skill-freshness tests regenerated/updated.
- [x] `bun test` green: 1198/1198. tsc + biome clean.

## Project-level deliverables (across all phases)

- [ ] Single PR closing #63 (or per-phase PRs if sir prefers).
- [ ] `BACKLOG.md` reviewed — anything discovered during work goes here or to a fresh issue.
- [ ] Project completion: walk PS1–PS32, verify every requirement is satisfied or moved to BACKLOG with justification.
- [ ] Project retrospective at `docs/planning/carbon/RETRO.md`.

## Carbon — Sub-project Status

Phase 1: ✅ COMPLETE
Phase 2: ✅ COMPLETE
Phase 3: ✅ COMPLETE
Phase 4: ✅ COMPLETE
Phase 5: ✅ COMPLETE
