# Phase 4 — Short Memory

Living scratchpad for cross-sub-phase context. Updated as 4.1/4.2/4.3 progress.

## Goal recap

Every resolver / install error names the manifest that imposed the constraint and the dep involved. Closes #85.

## Architectural decisions taken so far

- **Constraint shape**: extending `{name, constraint}` to `{name, constraint, source: ConstraintSource}` where `ConstraintSource = {kind:"consumer",manifestPath} | {kind:"transitive",originRepo,ref}`. Chosen over carrying `manifestPath` as a flat string because the transitive case wants the ref too.
- **Manifest path display**: consumer = `skilltree.yml` (literal, relative). Transitive = `<repo>/skilltree.yml@<ref-short>`. Decision driver: short enough to fit on one error line, long enough to point uniquely.
- **Snapshot test strategy**: one big `error-attribution-snapshot.test.ts` rather than scattering snapshots across existing files. Reason: the audit table maps 1:1 onto the test cases, so the file IS the catalogue's executable form.

## Open questions

- (4.2) Where to plumb `source` from in `resolveRepoVersions` (graph.ts:134-151)? Two options:
  - Pass `defaultSource = {kind:"consumer", manifestPath}` to the function and let it stamp every constraint built from `expanded.dependencies`.
  - Build constraints with `source` set at the call site (`processDeps`).
  Lean: first option — cleaner because `expanded` is already the materialized consumer manifest.
- (4.3) Where does `ResolvedEntity.declaredIn` get set for synthetic deps (`tryResolveFromSameRepo`'s `syntheticDep`)? Likely `manifestPath: "<repo>/skilltree.yml@<ref>"` per the parent's repo.

## Snapshot stability gotchas

- Cache paths under `~/.skilltree/cache/` show up in some error strings. Normalize via test helper before snapshotting.
- Short SHA prefix length: standardize to 7 (matches `SHORT_SHA_LEN` in `src/commands/list.ts`).

## In-flight state

- Phase 4.1: not started
- Phase 4.2: not started
- Phase 4.3: not started

## Issues / PRs

- Tracking issue: #85
- Phase 4.1 PR: tbd
- Phase 4.2 PR: tbd
- Phase 4.3 PR: tbd

## Adjacent files to keep in mind

- `src/core/resolver.ts` — small, easy to extend in-place
- `src/core/graph.ts` — large; mostly affected at lines 134-205, 252, 795-816
- `src/core/installer.ts` — only line 361 to touch
- `src/types.ts` — likely adds `ConstraintSource` and `declaredIn` field
- `tests/core/error-attribution-snapshot.test.ts` — new; created in 4.1
