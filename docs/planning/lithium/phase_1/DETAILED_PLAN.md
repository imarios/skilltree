# Lithium Phase 1: Infrastructure - Detailed Plan

## Goal

Build the data layer and CLI commands for registry management. After this phase, a user can `skilltree registry add/remove/list` and the global config + cache directories are properly managed.

## Architecture

### New Types (`src/types.ts`)

```typescript
// Entry in ~/.skilltree/config.yaml
interface RegistryEntry {
  name: string;
  repo: string;
}

// The full global config file
interface RegistryConfig {
  registries: RegistryEntry[];
}

// A single entity in the search index
interface IndexEntry {
  name: string;
  type: EntityType;
  path: string;
  description?: string;
  tags?: string[];
}

// The cached index.json per registry
interface RegistryIndex {
  registry: string;
  repo: string;
  updated_at: string; // ISO 8601
  entities: IndexEntry[];
}
```

### New Modules

**`src/core/registry-config.ts`** -- Global config CRUD
- `getConfigDir()` -> `~/.skilltree/`
- `getConfigPath()` -> `~/.skilltree/config.yaml`
- `readConfig()` -> parse YAML, return `RegistryConfig` (empty registries array if file missing)
- `writeConfig(config)` -> serialize and write
- `addRegistry(name, repo)` -> validate unique name, append, write
- `removeRegistry(name)` -> remove by name, write (error if not found)
- `listRegistries()` -> return `RegistryEntry[]`

**`src/core/registry-cache.ts`** -- Cache directory management
- `getRegistryCacheDir()` -> `~/.skilltree/registry-cache/`
- `getRegistryRepoDir(name)` -> `~/.skilltree/registry-cache/{name}/repo/`
- `getRegistryIndexPath(name)` -> `~/.skilltree/registry-cache/{name}/index.json`
- `readRegistryIndex(name)` -> parse index.json, return `RegistryIndex | null`
- `writeRegistryIndex(index)` -> write index.json
- `isStale(name, ttlMs)` -> check updated_at against TTL (default 24h)
- `cleanRegistryCache(name)` -> rm -rf the registry cache dir
- `ensureRegistryRepo(name, repoUrl)` -> clone bare or fetch existing

**`src/commands/registry.ts`** -- CLI handlers
- `registryAddCommand(url, opts)` -- infer name from URL, validate, call addRegistry
- `registryRemoveCommand(name)` -- call removeRegistry + cleanRegistryCache
- `registryListCommand()` -- read config + read each index.json for entity count/timestamp

### Name Inference

URL `github.com/imarios/vibes` -> name `vibes` (last path segment).
URL `github.com/company/private-skills` -> name `private-skills`.
Strip `.git` suffix before extracting.
If inferred name conflicts with existing, error with "--name" suggestion.

### File Layout

```
~/.skilltree/
  config.yaml           # { registries: [{ name, repo }] }
  registry-cache/
    vibes/
      repo/             # bare git clone
      index.json        # { registry, repo, updated_at, entities }
```

### CLI Structure

```
skilltree registry add <url> [--name <alias>]
skilltree registry remove <name>
skilltree registry list
```

`registry` is a parent command (like `deps` and `cache`) with subcommands.

## Task Breakdown

1. **Types** -- Add registry interfaces to `src/types.ts`
2. **Config module** -- `src/core/registry-config.ts` with read/write/add/remove/list
3. **Cache module** -- `src/core/registry-cache.ts` with dir helpers, index read/write, staleness check, cleanup, ensureRegistryRepo
4. **Registry commands** -- `src/commands/registry.ts` with add/remove/list handlers
5. **CLI wiring** -- Wire `registry` parent command with subcommands in `src/cli.ts`

## Dependencies

- `yaml` (already a dep) for config parsing
- `simple-git` (already a dep) for bare clone/fetch
- No new dependencies needed

## Edge Cases

- Config file doesn't exist yet (first `registry add`) -> create it
- Config file is empty or malformed -> treat as empty registries list
- Registry name conflicts on add -> error with suggestion
- Remove nonexistent registry -> error
- List with no registries -> "No registries configured" message
- Cache dir doesn't exist -> create on first use
- index.json missing (never updated) -> return null from readRegistryIndex
