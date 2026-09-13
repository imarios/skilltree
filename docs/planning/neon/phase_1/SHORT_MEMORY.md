# Phase 1 — Short Memory

## Stubs to implement

- [ ] `src/types.ts`: `frozen?: string` on `RemoteDependency`, `SourceDependency`
- [ ] `src/core/manifest.ts`: `validateFrozen` wired into `validateManifest`, `validatePackRef`, pack members
- [ ] `src/core/git.ts`: `FROZEN_REF_PREFIX`, `readRef`, `writeRef`
- [ ] `src/core/graph.ts`: `resolutionKey`, `resolveFrozen`, skip frozen in `resolveRepoVersions`, `ResolvedEntity.frozen`, key-based lookups at every `repoResolutions.get` site
- [ ] lockfile consistency: changed `frozen:` triggers re-resolve

## Tests written (red → green)

- [ ] MV1–MV7
- [ ] FZ1–FZ8
- [ ] PR1–PR5
- [ ] LI1–LI3

## Notes

- Reads already go through `entity.tag ?? entity.commit` (`installer.ts`, `graph.ts`), so a frozen dep whose tag vanished works by leaving `tag` unset.
- `repoResolutions.get` sites at plan time: graph.ts ~377 (packs), ~765 (`resolveRemoteEntity`), ~972 (origin tier), ~1255/1273/1286/1298 (same-repo tier), ~1160 (stale-tag check iterates).
- `addTagToRepo` fetches into the bare fixture without `--prune`; PR2/PR3 delete or move the tag directly in the bare fixture, then let `ensureCached` prune the skilltree cache.
- `install --frozen` already exists (lockfile-strict install). Use `frozenTag`/`dep.frozen` in code; flag the naming overlap to the user.
- Out of scope, filed as a task chip: `CACHE_DIR` in git.ts uses `os.homedir()` at load, so tests write into the real `~/.skilltree/cache`. These tests will too until that lands.
