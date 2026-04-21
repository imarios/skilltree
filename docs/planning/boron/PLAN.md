# Boron — Origin-Manifest Resolution for Direct Deps

Project-Type: production
Sub-Project: Boron (started 04/21/2026)

Spec: [docs/specs/origin_manifest_resolution.md](../../specs/origin_manifest_resolution.md) (v2.0)

Prior work (v1.x of the spec, shipped outside this sub-project): transitive origin-manifest lookup (R1–R8). Boron extends the feature to **direct dependencies**: R9–R13.

## Phase 1: Path-Optional Direct Deps
<!-- Spec: origin_manifest_resolution.md -->

Schema changes and resolver tier that infers a missing `path:` from origin's `skilltree.yaml` (with convention-probe fallback).

### Tasks
- [ ] `RemoteDependency.path` becomes optional in `src/types.ts` (and mirror on `SourceDependency`). Add `force_path?: boolean`. (R11, R12)
- [ ] `validateManifest` in `src/core/manifest.ts` no longer errors when `path:` is missing on a remote/source dep. Path-presence is validated later by the resolver.
- [ ] `parseManifest` and `serializeManifest` preserve `force_path` round-trip.
- [ ] `resolveRemoteEntity` in `src/core/graph.ts`: when `dep.path` is missing, call a new `inferDirectDepPath(dep, resolution, state)` helper before `pathExistsAtRef`. Helper returns the inferred path string, or `null`. Missing path + no inference → clear R9 error.
- [ ] `inferDirectDepPath` implementation:
  - Read origin's `skilltree.yaml` at `resolution.tag ?? resolution.commit`. Silent bail on missing/malformed.
  - Look up entity's **actual name** (YAML key OR `dep.name` alias) in origin's `dependencies` (never `dev-dependencies`).
  - `local:` (relative) → return `stripDotSlash(local)`.
  - `local:` (absolute) → return `null` (R8-style skip).
  - `repo:` matching consumer's `dep.repo` → return origin's `path`.
  - `repo:` pointing elsewhere → return `null`.
  - If not found in origin, probe conventional paths (`skills/<name>/SKILL.md`, `agents/<name>.md`, `<name>/SKILL.md`) at the resolved ref.
  - Return the first successful path or `null`.
- [ ] Tests (`tests/core/graph-direct-path-inference.test.ts`) — R9 matrix, 13 scenarios per spec Testing Checklist.
- [ ] Full `bun test` green.

## Phase 2: Redundancy & Override Warnings
<!-- Spec: origin_manifest_resolution.md -->

Warn when consumer's `path:` duplicates or overrides origin's declared path. Opt-out via `force_path: true`.

### Tasks
- [ ] New helper `detectPathWarning(dep, originPath)` returns `"redundant" | "override" | null`.
- [ ] Wire into `resolveRemoteEntity` after `inferDirectDepPath` such that warnings fire whether or not inference was needed. Skip entirely when `dep.force_path === true`.
- [ ] Messages match spec examples (name both paths, suggest `force_path`).
- [ ] Warnings stored in `state.warnings`; surfaced in install output via existing channel.
- [ ] Tests (`tests/core/graph-path-warnings.test.ts`) — R10 matrix, 8 scenarios.
- [ ] Side-quest audit: grep tests for `source:` alias miss / `path:` missing scenarios. Document findings in SHORT_MEMORY.md; add missing coverage tests.
- [ ] Full `bun test` green.

## Phase 3: CLI `--path` Optional
<!-- Spec: origin_manifest_resolution.md -->

`skilltree add --repo <url>` accepts omitted `--path`. Manifest writer preserves the omission.

### Tasks
- [ ] `src/commands/add.ts`: remove `--path` required check for `--repo`/`--source` flows. Update help text.
- [ ] Manifest writer writes entries without `path:` when the user omits it.
- [ ] Tests (`tests/commands/add-no-path.test.ts`) — 2 scenarios: add writes missing path; subsequent install resolves via R9 or errors via R9-style error.
- [ ] Full `bun test` green.
- [ ] Update `README.md` → "Quick Start" example can omit path when origin ships a manifest. One-line mention.

## Phase 4: Documentation + Real-World Verification

Round out docs and verify against `backendv2-y` end to end.

### Tasks
- [ ] `docs/specs/reference.md` — append R9/R10 section under "Phase 1: Graph Construction" (resolution order for direct deps).
- [ ] `docs/specs/spec.md` — update "Transitive Resolution" section to rename to "Origin-Manifest Resolution" and cover direct-dep inference.
- [ ] Rebuild binary, run against `/Users/imarios/Projects/backendv2-y` as a consumer with `path:` omitted on all direct deps, verify clean install.
- [ ] Phase retrospective in `docs/planning/boron/phase_4/RETRO.md` (cycle 095).
