# Lithium - Registries and Discovery

Project-Type: production
Sub-Project: Lithium (started 03/31/2026)

Spec: [docs/specs/registries.md](../../specs/registries.md)

## Phase 1: Infrastructure ✅ COMPLETE

Global config, registry CRUD commands, and cache management. No search, no scanning -- just the data layer and CLI wiring for `skilltree registry add|remove|list|update`.

### Tasks
- [x] Registry types (`src/types.ts`) -- `RegistryEntry`, `RegistryConfig`, `IndexEntry`, `RegistryIndex` interfaces
- [x] Global config module (`src/core/registry-config.ts`) -- read/write `~/.skilltree/config.yaml`, add/remove/list registries, validate unique names
- [x] Registry cache module (`src/core/registry-cache.ts`) -- clone/fetch bare repos to `~/.skilltree/registry-cache/<name>/repo/`, read/write `index.json`, TTL staleness check, cache cleanup
- [x] `skilltree registry add <url>` command -- name inference from URL, `--name` flag, duplicate detection, writes to global config
- [x] `skilltree registry remove <name>` command -- remove from config + delete cache directory
- [x] `skilltree registry list` command -- tabular output with name, repo URL, entity count, last updated
- [x] CLI wiring (`src/cli.ts`) -- `registry` parent command with `add`, `remove`, `list` subcommands

## Phase 2: Search ✅ COMPLETE

`registry update` (fetch + index build), `skilltree search`, `skilltree info`, `skilltree index`, dynamic scanning fallback.

### Tasks
- [x] Registry scanner (`src/core/registry-scanner.ts`) -- dynamic scan via `git ls-tree -r HEAD` + frontmatter reading, `skillkit-index.yaml` parsing, both produce `IndexEntry[]`
- [x] `skilltree registry update [name]` command -- fetch repo, scan/parse index, write `index.json`
- [x] Search engine (`src/core/registry-search.ts`) -- tokenization, scoring (name/tag/description), AND semantics, sort by score
- [x] `skilltree search <query>` command -- search across registries, formatted output with copy-pasteable `add` commands, `--registry`, `--type`, `--json` flags, stale cache warnings
- [x] `skilltree info <name>` command -- detailed entity info, version listing, multi-registry display
- [x] `skilltree index` command -- generate `skillkit-index.yaml` from local filesystem scan, `--check` flag for CI

## Phase 3: Registry-Assisted Add ✅ COMPLETE

Enhanced `skilltree add <name>` that resolves from registries when no `--repo`/`--source`/`--local` given.

### Tasks
- [x] Registry lookup in add command -- search registries for exact name match when no location flags provided
- [x] Interactive disambiguation -- multiple matches list options with `--registry` suggestion
- [x] Error messages -- "not found in any registry" with `search` suggestion, "no registries configured" guidance
- [x] Full-form write -- always writes explicit `repo:` + `path:` to manifest regardless of how it was resolved
- [x] `--registry` flag on `add` command for disambiguation
- [x] Makefile `setup` target includes `teach` to keep skilltree skill up to date
- [x] commands.md updated with registry-assisted add examples
