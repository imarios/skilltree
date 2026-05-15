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

## Phase 1: Foundation — types, validation, visibility predicate
<!-- Spec: publication_surface.md PS1–PS5, PS27–PS28 -->

Lay the foundation: schema fields, validation, and one helper that every subsequent phase calls. No use sites are wired up yet — Phase 1 produces dead code that gets activated in Phases 2–5.

### Tasks
- [ ] Add `publish?: boolean` and `exclude?: string[]` to the `Dependency` type in `src/types.ts` (and any mirrored types for local/remote variants). (PS3, PS6)
- [ ] `parseManifest` / `serializeManifest` in `src/core/manifest.ts`: round-trip the two new fields. Preserve omission when the user didn't set them.
- [ ] `validateManifest`: reject `publish:` or `exclude:` on remote entries (`repo:` / `source:` without local-source filesystem expansion). Type-check `publish` is boolean and `exclude` is `string[]`. Clear actionable error messages. (PS4, PS7, PS27, PS28)
- [ ] New file `src/core/visibility.ts` with `isPubliclyVisible(entry: Dependency, group: "dependencies" | "dev-dependencies"): boolean`. Single source of truth. (PS1, PS2)
- [ ] Tests (`tests/core/manifest-publish-exclude.test.ts`): round-trip; reject on remote entries; type errors. Parametrized.
- [ ] Tests (`tests/core/visibility.test.ts`): predicate table covering all four combinations (group × publish flag) plus default (publish omitted).
- [ ] No use sites changed yet — Phase 1 is foundation only.

## Phase 2: Registry-scanner fallback + index filtering
<!-- Spec: publication_surface.md PS12–PS14 -->

Wire the visibility predicate into registry indexing and add the `skilltree.yml`-as-index fallback tier.

### Tasks
- [ ] `src/core/registry-scanner.ts`: insert tier 2 (manifest-derived) between curated `skilltree-index.yml` and the dynamic `git ls-tree` scan. Reads the repo's `skilltree.yml` at HEAD via `git show`, extracts `dependencies` `local:` entries, filters by visibility predicate. (PS12, PS13)
- [ ] `src/core/registry-scanner.ts`: dynamic-scan tier (tier 3) also filters by visibility — but the predicate needs `skilltree.yml` to know which paths are `publish:false`. Pre-load the manifest once at scan start; for paths not in the manifest, treat as visible (no manifest entry = no signal, conservative).
- [ ] `src/commands/registry.ts` (or wherever `registry index` lives): when generating `skilltree-index.yml`, skip entries with `publish: false`. (PS14)
- [ ] Tests (`tests/core/registry-scanner-fallback.test.ts`): three-tier fallback ordering; manifest tier surfaces only visible entries; dynamic tier filters by manifest where available.
- [ ] Tests (`tests/commands/registry-index-publish.test.ts`): `registry index` generation skips `publish:false`.
- [ ] Update `docs/specs/registries.md` to document the fallback chain. (PS29)

## Phase 3: Installer + vendor — exclude and .skilltreeignore
<!-- Spec: publication_surface.md PS6–PS11, PS17, PS20–PS22 -->

File-level trim. Introduces a glob-based ignore engine and wires it into both installer and vendor copy paths.

### Tasks
- [ ] New file `src/core/ignore.ts`: thin wrapper around a gitignore-style matcher. Accepts a list of patterns + a base path; returns a `shouldExclude(file: string): boolean` function. Composable across the two scopes. (PS9, PS11)
- [ ] `src/core/manifest.ts` (or new helper): load `.skilltreeignore` from repo root if present; expose to installer/vendor.
- [ ] `src/core/installer.ts`: when copying a local entity, build the combined matcher (entity-relative `exclude:` + repo-relative `.skilltreeignore`) and skip excluded files. (PS17)
- [ ] `src/commands/vendor.ts`: apply visibility predicate to entity selection (skip `publish:false`); apply combined matcher when copying. (PS20, PS21)
- [ ] Tests (`tests/core/ignore.test.ts`): parametrized — leading slash, trailing slash, double-star, negation, layering precedence. Gitignore semantics.
- [ ] Tests (`tests/core/installer-exclude.test.ts`): copy with `exclude:` only; copy with `.skilltreeignore` only; copy with both layered.
- [ ] Tests (`tests/commands/vendor-publish-exclude.test.ts`): `publish:false` skipped; `exclude:` honored; `.skilltreeignore` honored.
- [ ] Vendor inconsistency audit (open question from spec): does `vendor` today include `dev-dependencies` local entries? Document finding; fix if it does (extension of PS20).

## Phase 4: Graph extension — downstream visibility error
<!-- Spec: publication_surface.md PS15–PS16 -->

Extend origin-manifest lookup so a downstream chain hitting a `publish:false` entry produces the same actionable error already used for `dev-dependencies`.

### Tasks
- [ ] `src/core/graph.ts`: in the origin-manifest lookup path, when an origin's entry matches a name but the origin manifest marks it `publish: false`, record a hint in `originDevDepHints` (or a sibling map) with the `publish:false` reason. (PS15)
- [ ] Error formatting: produce a distinct message that names the reason (`dev-dependencies` vs `publish: false`) so the consumer's fix is obvious. (PS16)
- [ ] Tests (`tests/core/graph-publish-downstream.test.ts`): downstream resolution fails cleanly when transitive dep is `publish:false`; error text matches; distinguishes from the `dev-dependencies` case.
- [ ] Update `docs/specs/reference.md` to document the new resolution-failure reason. (PS31)

## Phase 5: `check` lint — asymmetric publish state
<!-- Spec: publication_surface.md PS23–PS26 -->

Catch the footgun: a published entity transitively depends on a same-repo `publish:false` entity. The maintainer's local install succeeds, but downstream consumers fail at install time.

### Tasks
- [ ] `src/commands/check.ts` (extend or create): for each `publish !== false` local entity, walk its dependency graph using existing resolver primitives. Restrict the walk to same-repo `local:` deps. Flag any reachable `publish:false` entity with the full chain. (PS23, PS25)
- [ ] Error formatting: render the chain (`analysis-pipeline → data-loader → experimental-refactor (publish: false)`) so the fix is obvious. (PS24)
- [ ] Wire as a warning into `check`'s existing pass; non-zero exit only in strict mode (consistent with other warnings). (PS26)
- [ ] Tests (`tests/commands/check-asymmetric-publish.test.ts`): direct dep case; transitive (2-hop, 3-hop) case; no warning when chain is consistent; no warning when chain crosses into a different repo.
- [ ] Update `README.md` with publication-surface section (concept + `publish: false` / `exclude:` mechanics). (PS32)
- [ ] Update `docs/specs/spec.md` with `publish:` field reference + visibility predicate. (PS30)

## Project-level deliverables (across all phases)

- [ ] Single PR closing #63 (or per-phase PRs if sir prefers).
- [ ] `BACKLOG.md` reviewed — anything discovered during work goes here or to a fresh issue.
- [ ] Project completion: walk PS1–PS32, verify every requirement is satisfied or moved to BACKLOG with justification.
- [ ] Project retrospective at `docs/planning/carbon/RETRO.md`.

## Carbon — Sub-project Status

Phase 1: PENDING
Phase 2: PENDING
Phase 3: PENDING
Phase 4: PENDING
Phase 5: PENDING
