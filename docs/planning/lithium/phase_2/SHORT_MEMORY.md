# Lithium Phase 2: Short Memory

## Stubs Created

### src/core/registry-scanner.ts
- [ ] `scanRegistry(repoDir)` -- try index.yaml, fall back to dynamic
- [ ] `parseSkillkitIndex(yamlContent)` -- parse skillkit-index.yaml
- [ ] `dynamicScanRepo(repoDir)` -- git ls-tree + frontmatter scan

### src/core/registry-search.ts
- [ ] `searchRegistries(query, indexes, options?)` -- tokenize, score, sort
- [ ] `scoreEntity(tokens, entity)` -- score one entity against tokens

### src/commands/search.ts
- [ ] `searchCommand(query, opts, configPath?, cacheDir?)` -- CLI handler

### src/commands/info.ts
- [ ] `infoCommand(name, configPath?, cacheDir?)` -- detailed entity info

### src/commands/index-cmd.ts
- [ ] `indexCommand(opts, dir?)` -- generate skillkit-index.yaml

### src/commands/registry.ts (extend)
- [ ] `registryUpdateCommand(name?, configPath?, cacheDir?)` -- fetch + scan + write index

### src/cli.ts
- [ ] Wire `registry update`, `search`, `info`, `index` commands

## Notes
- Scanner reuses existing `parseFrontmatter` and `readFileAtRef` from git.ts
- Search engine is pure functions (no I/O) — easy to test
- `index-cmd.ts` named to avoid conflict with `index.ts` module resolution
