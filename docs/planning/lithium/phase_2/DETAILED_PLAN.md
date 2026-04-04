# Lithium Phase 2: Search - Detailed Plan

## Goal

Build the scanning, indexing, and search pipeline. After this phase, `skilltree registry update vibes` scans the repo for skills/agents, builds `index.json`, and `skilltree search python` finds matching entities with copy-pasteable `add` commands.

## New Modules

### `src/core/registry-scanner.ts` — Scan repos for skills/agents

Two paths that both produce `IndexEntry[]`:

**Path A: `skillkit-index.yaml` (fast path)**
- `git show HEAD:skillkit-index.yaml` from bare repo
- Parse YAML, validate shape, return entities

**Path B: Dynamic scan (fallback)**
- `git ls-tree -r HEAD` to get all paths
- Filter for `SKILL.md` files → parent dir is the skill path
- Filter for `.md` files that look like agents (have frontmatter with `skills:` or agent patterns)
- For each match, `git show HEAD:<path>` to read content, parse frontmatter
- Extract `name` (from frontmatter or directory name), `type`, `path`, `description`
- No `tags` from dynamic scan (not in SKILL.md standard)

Key functions:
- `scanRegistry(repoDir: string): Promise<IndexEntry[]>` — try index.yaml, fall back to dynamic
- `parseSkillkitIndex(yamlContent: string): IndexEntry[]` — parse skillkit-index.yaml
- `dynamicScanRepo(repoDir: string): Promise<IndexEntry[]>` — git ls-tree + frontmatter

### `src/core/registry-search.ts` — Search engine

- `searchRegistries(query: string, registries, options): SearchResult[]`
- `scoreEntity(tokens: string[], entity: IndexEntry): number`
- Tokenization: split query into lowercase tokens
- AND semantics: all tokens must match somewhere
- Scoring: exact name=100, name contains=10, tag=5, description=1
- Sort by score desc, tiebreak alphabetically

### New commands

- `registryUpdateCommand(name?: string)` — in `src/commands/registry.ts` (extend existing file)
- `searchCommand(query: string, opts)` — `src/commands/search.ts`
- `infoCommand(name: string, opts)` — `src/commands/info.ts`
- `indexCommand(opts)` — `src/commands/index.ts`

## Task Breakdown

1. **Registry scanner** — `src/core/registry-scanner.ts`
2. **Registry update command** — extend `src/commands/registry.ts`
3. **Search engine** — `src/core/registry-search.ts`
4. **Search command** — `src/commands/search.ts`
5. **Info command** — `src/commands/info.ts`
6. **Index command** — `src/commands/index.ts` (for repo maintainers)
7. **CLI wiring** — add `update` to registry, add `search`, `info`, `index` to cli.ts

## Dependencies on Phase 1

- `ensureRegistryRepo` — clone/fetch bare repo
- `writeRegistryIndex` / `readRegistryIndex` — persist index
- `isStale` — staleness warnings
- `listRegistries` — get all registries
- `readFileAtRef` from git.ts — read files from bare repo
- `parseFrontmatter` from frontmatter.ts — extract entity metadata
- `listTags` from git.ts — for `info` version listing

## Edge Cases

- Repo with `skillkit-index.yaml` → use it (no scanning)
- Repo without `skillkit-index.yaml` → dynamic scan
- `.md` file that is NOT an agent (no frontmatter, or README.md) → skip
- Skill directory without `SKILL.md` → skip
- Empty repo → 0 entities
- `search` with no registries → error with guidance
- `search` with never-updated registry → skip with message
- `search` with stale registry → warning
- `info` with name in multiple registries → show all
- `index` run outside a skill repo → scan finds nothing
