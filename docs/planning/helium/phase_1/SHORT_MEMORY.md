# Short Memory — Helium Phase 1

## Files to modify
- [ ] `src/core/lockfile.ts` — add `diffManifestLockfile()`
- [ ] `src/core/graph.ts` — add `resolveWithLockfile()`
- [ ] `src/commands/install.ts` — rewrite to use lockfile-first flow + frozen + validation
- [ ] `src/core/manifest.ts` — no changes (validateManifest already exists)

## New test files
- [ ] `tests/core/lockfile-diff.test.ts`
- [ ] `tests/commands/install-lockfile.test.ts` (lockfile-first + frozen)

## Key invariants
- Remote deps: lockfile is cache, only re-resolve when manifest entry changed
- Local deps: ALWAYS re-read from filesystem
- `--frozen`: lockfile is sole truth, error on any mismatch
- Failed resolution: never write lockfile
