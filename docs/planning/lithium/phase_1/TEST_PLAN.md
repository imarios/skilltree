# Lithium Phase 1: Infrastructure - Test Plan

## Test Files

### `tests/core/registry-config.test.ts`

**Positive:**
- [x] readConfig returns empty registries when config file doesn't exist
- [x] readConfig parses valid config.yaml with multiple registries
- [x] writeConfig creates config file and parent dirs
- [x] writeConfig serializes registries correctly
- [x] addRegistry appends a new registry entry
- [x] addRegistry creates config file on first use
- [x] removeRegistry removes an existing entry by name
- [x] listRegistries returns all entries from config

**Negative:**
- [x] addRegistry errors on duplicate name
- [x] removeRegistry errors on nonexistent name
- [x] readConfig handles empty file gracefully (returns empty list)
- [x] readConfig handles malformed YAML (returns empty list or errors clearly)

### `tests/core/registry-cache.test.ts`

**Positive:**
- [x] getRegistryRepoDir returns correct path
- [x] getRegistryIndexPath returns correct path
- [x] writeRegistryIndex writes valid JSON
- [x] readRegistryIndex reads back written index
- [x] readRegistryIndex returns null when index.json doesn't exist
- [x] isStale returns false for recent index
- [x] isStale returns true for old index
- [x] isStale returns true when index doesn't exist
- [x] cleanRegistryCache removes the registry directory
- [x] cleanRegistryCache is no-op for nonexistent cache

**Git operations (with fixture repos):**
- [x] ensureRegistryRepo clones a bare repo on first call
- [x] ensureRegistryRepo fetches on subsequent calls

### `tests/commands/registry.test.ts`

**Positive:**
- [x] registry add writes entry to config
- [x] registry add infers name from URL (last path segment)
- [x] registry add respects --name flag
- [x] registry add strips .git from URL for name inference
- [x] registry add preserves SSH URL transport info
- [x] registry add preserves https:// prefix
- [x] registry remove removes entry and cleans cache
- [x] registry list shows all registries with counts and timestamps
- [x] registry list shows "No registries configured" when empty

**Negative:**
- [x] registry add errors on duplicate name
- [x] registry add errors on duplicate name with --name suggestion
- [x] registry remove errors on nonexistent registry
