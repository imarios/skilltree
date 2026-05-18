# Nitrogen Phase 4 — Retrospective

Shipped: 2026-05-18 (same day adopted).
Closes #85.

## What landed

- **Phase 4.1 (catalogue + harness)**: `docs/planning/nitrogen/phase_4/error-audit.md` inventories every resolver/installer error site. Snapshot harness `tests/core/error-attribution-snapshot.test.ts` exercises `resolveIntersection` in three shapes (single consumer, multi consumer, mixed consumer + transitive).
- **Phase 4.2 (resolver + graph attribution)**: introduced `ConstraintSource` + `Constraint` types in `src/core/resolver.ts`; plumbed source through `resolveRepoVersions` → `resolveOneRepo` → `resolveIntersection`. Error text now reads `skilltree.yml requires <dep> <version>` per the spec example in #85. Cross-repo transitive (`ensureRepoResolvedLazy`) now passes a real `ConstraintSource.transitive` instead of the `<transitive via …>` placeholder.
- **Phase 4.3 (collision attribution)**: introduced `EntityOrigin` on `ResolvedEntity.declaredIn`; `checkDuplicate` names both manifests in the error. Installer-path-missing error (`graph.ts:474`) gained `(declared in <manifest>)` suffix.
- Snapshot harness regenerated cleanly; existing tests that already used loose substring matches (`toContain("Incompatible")`) continued to pass without modification.

## Scope decision

Originally planned as 3 PRs (4.1 / 4.2 / 4.3). User asked for one PR mid-flight. Bundled — total diff ~280 lines across 8 files, slightly above PatchMode's nominal ceiling but cohesive. Mitigation: per-sub-phase commits would have been split into three; we landed one commit that covers all three sub-phases plus the audit.

## What went well

- **TypeScript ratcheted us through the plumbing**: changing `resolveIntersection`'s signature from `Array<{name, constraint}>` to `Array<Constraint>` (with a required `source` field) made the compiler enumerate every call site. No site was missed.
- **Snapshot harness from 4.1 was free insurance**: the only "drift" it caught was the intended one in 4.2 — every other test in the suite (1471 → 1472) passed without per-test updates because the existing assertions used loose substring matches.
- **`declaredIn` is opt-out**: marking the field optional on `ResolvedEntity` meant the half-dozen test files that hand-construct entities (e.g., `tests/core/graph-unhappy.test.ts`) didn't break. New production code paths all set it; old test fixtures don't have to.
- **Single helper, two consumers**: `formatConstraintSource` and `formatOrigin` parallel each other but stay separate. Earlier draft tried to share one helper; the discriminator field names differ (`originRepo` vs no-such-field for entity-origin's consumer) so collapsing was awkward. Two small functions is cleaner.

## What I would do differently

- **Cleaning orphan snapshots was friction**: bun's default snapshot append-on-rename behavior left stale Phase 4.1 entries in the snap file. Had to `rm` and rerun. A `bun test --update-snapshots` flag would have been cleaner if I'd remembered it earlier.
- **The `indentBlock` helper is one-shot in `graph.ts`**: only used once for wrapping `resolveIntersection`'s output in the version-conflict error. If a third use case shows up, move it to a shared util. For now, leaving it local.

## Surprises

- `tryResolveFromManifest` is on the *transitive* code path but the entity it resolves is *declared in the consumer manifest* (it's a key listed in `state.expanded.dependencies`). Easy to miss without reading carefully — we attribute correctly by passing `{kind: "consumer"}` explicitly. Documented in a code comment for future readers.
- The "synthetic dep" path in `tryResolveFromSameRepo` (conventional probe) creates an entity that lives in the parent's repo but isn't declared anywhere — it's *implied*. Attributed to the parent repo as `transitive`. Right call.

## Follow-ups discovered

None. The catalogue from 4.1 mapped exactly 5 fix-targets, all addressed in this PR. The "clear" sites stayed unchanged. The "out-of-scope" sites (manifest validation, lockfile parse) remain out of scope per #85.

## Metrics

- Lines: +260 / -65 net across 8 files (snapshot + planning excluded).
- Tests: 1467 (baseline) → 1471 (Phase 4.2) → 1472 (Phase 4.3). All green.
- Snapshots: 3 regenerated (Phase 4 attributed shape).
- CI: green on first push.

## Project-level closeout

- [x] PR #132 merges (was: "all three PRs ship" — collapsed to one per scope decision).
- [x] Planning docs updated.
- [x] PROJECTS.md moves Nitrogen back to Completed (date range 05/17 → 05/18).
- [x] #85 will close on PR merge (Closes #85 in body).
- [ ] Check #78 (Authoring UX v1) — all children of that milestone are now closed; close after #85 merges.
