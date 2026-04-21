# Boron — Origin-Manifest Resolution for Direct Deps

Project-Type: production
Sub-Project: Boron (started 04/21/2026)

Spec: [docs/specs/origin_manifest_resolution.md](../../specs/origin_manifest_resolution.md) (v2.0)

Prior work (v1.x of the spec, shipped outside this sub-project): transitive origin-manifest lookup (R1–R8). Boron extends the feature to **direct dependencies**: R9–R13.

## Phase 1: Path-Optional Direct Deps ✅ COMPLETE
<!-- Spec: origin_manifest_resolution.md -->

Schema changes and resolver tier that infers a missing `path:` from origin's `skilltree.yaml` (with convention-probe fallback).

### Tasks
- [x] `RemoteDependency.path` becomes optional in `src/types.ts` (and mirror on `SourceDependency`). Add `force_path?: boolean`. (R11, R12)
- [x] `validateManifest` in `src/core/manifest.ts` no longer errors when `path:` is missing on a remote/source dep. Path-presence is validated later by the resolver.
- [x] `parseManifest` and `serializeManifest` preserve `force_path` round-trip.
- [x] `resolveRemoteEntity` in `src/core/graph.ts`: when `dep.path` is missing, call a new `inferDirectDepPath(entityName, consumerRepo, resolution, state)` helper before `pathExistsAtRef`. Helper returns the inferred path string, or `null`. Missing path + no inference → clear R9 error.
- [x] `inferDirectDepPath` implementation (origin manifest → convention probe → null).
- [x] Tests (`tests/core/graph-direct-path-inference.test.ts`) — R9 matrix, 16 scenarios (13 R9 + 3 R12 validation).
- [x] Full `bun test` green (635/635).

## Phase 2: Redundancy & Override Warnings ✅ COMPLETE
<!-- Spec: origin_manifest_resolution.md -->

Warn when consumer's `path:` duplicates or overrides origin's declared path. Opt-out via `force_path: true`.

### Tasks
- [x] New helper `detectPathMismatch(entityName, consumerPath, consumerRepo, resolution)` returns `{kind: "redundant"|"override", originPath}` or null.
- [x] `formatPathWarning` produces spec-matching messages.
- [x] Wired into `resolveRemoteEntity` when `dep.path` is present and `dep.force_path !== true`.
- [x] Tests (`tests/core/graph-path-warnings.test.ts`) — 8 R10 scenarios + 1 side-quest (S2).
- [x] Side-quest audit complete: S1 (unknown source alias) already covered in `manifest.test.ts` + `manifest-comprehensive.test.ts`. S2 added in same file.
- [x] Full `bun test` green (644/644).

## Phase 3: CLI `--path` Optional ✅ COMPLETE
<!-- Spec: origin_manifest_resolution.md -->

`skilltree add --repo <url>` accepts omitted `--path`. Manifest writer preserves the omission.

### Tasks
- [x] `src/commands/add.ts`: removed `--path` required check for `--repo`/`--source` flows.
- [x] Manifest writer writes entries without `path:` when the user omits it (conditional assignment in `buildDependency`).
- [x] Tests: 2 R13 scenarios added inline in `tests/commands/add.test.ts` (replacing the pre-existing "require --path" negative test).
- [x] Full `bun test` green (645/645).
- [ ] README "Quick Start" update — handled in Phase 4.

## Phase 4: Documentation + Real-World Verification ✅ COMPLETE

Round out docs and verify against `backendv2-y` end to end.

### Tasks
- [x] `docs/specs/reference.md` — R9 direct-dep inference tier + R10 warning semantics documented.
- [x] `docs/specs/spec.md` — "Origin-Manifest Resolution" section added with direct-dep example; transitive resolution content retained beneath.
- [x] `README.md` — added "Origin-manifest resolution" subsection under "Transitive Dependencies".
- [x] `skills/skilltree/SKILL.md` — new "Origin-Manifest Resolution — Concepts Every Author and Consumer Should Know" section.
- [x] Rebuilt binary, ran against `~/Projects/backendv2-y` with consumer declaring only `task-builder + repo:` (no `path:`). All 5 skills (1 direct + 4 transitive) install clean. No false warnings.
- [x] False-positive discovered and fixed: R10 warnings no longer fire for synthesized (transitive) deps. `fromConsumerManifest` flag threaded through `resolveEntity` → `resolveRemoteEntity`.
- [x] Phase retrospective written.

## Boron — Sub-project Status

All 4 phases ✅ COMPLETE. 645 tests passing. Ready for git commit and sub-project closure.
