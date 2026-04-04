# Lithium Phase 1: Short Memory

## Stubs Created

### src/types.ts
- [x] `RegistryEntry` interface (added)
- [x] `RegistryConfig` interface (added)
- [x] `IndexEntry` interface (added)
- [x] `RegistryIndex` interface (added)

### src/core/registry-config.ts
- [x] `readConfig(configPath?)` -- read global config YAML
- [x] `writeConfig(config, configPath?)` -- write global config YAML
- [x] `addRegistry(name, repo, configPath?)` -- add entry, error on duplicate
- [x] `removeRegistry(name, configPath?)` -- remove entry, error if not found
- [x] `listRegistries(configPath?)` -- return all entries

### src/core/registry-cache.ts
- [x] `readRegistryIndex(name, cacheDir?)` -- read index.json, null if missing
- [x] `writeRegistryIndex(index, cacheDir?)` -- write index.json
- [x] `isStale(name, ttlMs?, cacheDir?)` -- check TTL
- [x] `cleanRegistryCache(name, cacheDir?)` -- rm -rf cache dir
- [x] `ensureRegistryRepo(name, repoUrl, cacheDir?)` -- clone/fetch bare repo

### src/commands/registry.ts
- [x] `inferRegistryName(url)` -- extract last path segment
- [x] `registryAddCommand(url, opts, configPath?)` -- add with name inference
- [x] `registryRemoveCommand(name, configPath?, cacheDir?)` -- remove + clean cache
- [x] `registryListCommand(configPath?, cacheDir?)` -- tabular output

### src/cli.ts
- [x] Wire `registry` parent command with `add`, `remove`, `list` subcommands

### skills/skilltree/references/commands.md
- [x] Added `registry add`, `registry remove`, `registry list` docs

### src/core/git.ts (hardening additions)
- [x] `normalizeGitUrl(url)` -- canonical display form (strips all protocol info)
- [x] `cleanGitUrl(url)` -- cloneable form (preserves transport info like git@)
- [x] `toGitCloneUrl(repo)` -- prepend https:// unless SSH/local/full URL
- [x] `cloneOrFetchBare(repoUrl, targetDir)` -- shared clone/fetch with corrupt-dir recovery
- [x] `repoCachePath` refactored to call `normalizeGitUrl`

## Notes
- All stubs accept optional path overrides for testability (avoid touching real ~/.skilltree/)
- Pattern follows existing codebase: getCacheDir() for path constants, actual fs operations in functions
- All 254 tests pass (40 new + 214 existing)
- Code hardening: 3 rounds of hypothesis-driven review, 8 issues fixed (URL normalization duplication, SSH auth preservation, corrupt cache recovery, TOCTOU fixes)
