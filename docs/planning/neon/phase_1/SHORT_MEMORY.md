# Phase 1 — Short Memory

## Stubs to implement

- [x] `src/types.ts`: `frozen?: string` on `RemoteDependency`, `SourceDependency`
- [x] `src/core/manifest.ts`: `parseFrozenVersion`, `validateFrozen` wired into `validateManifest`, `validatePackRef`, pack members
- [x] `src/core/git.ts`: `FROZEN_REF_PREFIX`, `readRef`, `writeRef`; first fetch gets `--force`
- [x] `src/core/graph.ts`: `resolutionKey`, `inheritFrozen`, `resolveFrozen`, `frozenAttempted`, skip frozen in `resolveRepoVersions`, `ResolvedEntity.frozen`, key-based lookups; `resolveOriginRemoteEntry` extracted (complexity lint)
- [ ] `src/core/lockfile.ts` `classifyDep`: changed `frozen:` triggers re-resolve

## Tests written (red → green)

- [x] MV1–MV7
- [x] FZ1–FZ8
- [x] PR1–PR5 (implementation for the preserved ref landed before these ran red — PR3/PR4 still caught two real bugs)
- [ ] LI1–LI3

## Notes

- Reads already go through `entity.tag ?? entity.commit` (`installer.ts`, `graph.ts`), so a frozen dep whose tag vanished works by leaving `tag` unset.
- `repoResolutions.get` sites at plan time: graph.ts ~377 (packs), ~765 (`resolveRemoteEntity`), ~972 (origin tier), ~1255/1273/1286/1298 (same-repo tier), ~1160 (stale-tag check iterates).
- `addTagToRepo` fetches into the bare fixture without `--prune`; PR2/PR3 delete or move the tag directly in the bare fixture, then let `ensureCached` prune the skilltree cache.
- `install --frozen` already exists (lockfile-strict install). Use `frozenTag`/`dep.frozen` in code; flag the naming overlap to the user.
- Preserved ref is named by **version**, not tag spelling: `refs/skilltree/frozen/0.4.0`. The tag spelling can vanish upstream; the version can't.
- Found via PR3: a tag moved upstream made `git fetch --tags` fail ("would clobber existing tag"), which fell into `cloneOrFetchBare`'s catch-all and wiped + re-cloned the cache, dropping preserved refs. Fixed with `--force` on that fetch. Pre-existing bug: every moved tag cost a full re-clone.
- Found via PR4/FZ7: `resolveRepoVersions` runs twice (pack Phase 1.5b), so a failed frozen lookup reported its error twice. Guarded with `state.frozenAttempted`.
- **Carry into Phase 2:** the lockfile doesn't record that an entry was frozen, so removing `frozen:` by hand leaves the old version locked (it still satisfies `*`). `unfreeze` must force re-resolution — clear the entry like selective `update` does — or the lockfile needs an additive optional `frozen` field. Decide in Phase 2.
- Remaining limitation: `cache clean` or a re-clone (URL drift, corrupt cache) drops preserved refs. Fresh-machine behavior is the documented error.
- Out of scope, filed as a task chip: `CACHE_DIR` in git.ts uses `os.homedir()` at load, so tests write into the real `~/.skilltree/cache`. These tests will too until that lands.
