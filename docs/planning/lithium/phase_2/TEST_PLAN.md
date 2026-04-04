# Lithium Phase 2: Search - Test Plan

## Test Files

### `tests/core/registry-scanner.test.ts`

**skillkit-index.yaml parsing:**
- [ ] parseSkillkitIndex parses valid index with skills and agents
- [ ] parseSkillkitIndex handles entries without optional fields (description, tags)
- [ ] parseSkillkitIndex returns empty array for empty entities list

**Dynamic scanning (with git fixture repos):**
- [ ] dynamicScanRepo finds skills (directories with SKILL.md)
- [ ] dynamicScanRepo finds agents (standalone .md files with frontmatter)
- [ ] dynamicScanRepo skips non-skill .md files (README.md, CHANGELOG.md)
- [ ] dynamicScanRepo extracts name from frontmatter when present
- [ ] dynamicScanRepo falls back to directory name when frontmatter has no name
- [ ] dynamicScanRepo extracts description from frontmatter
- [ ] dynamicScanRepo returns empty array for repo with no skills

**scanRegistry (integration):**
- [ ] scanRegistry uses skillkit-index.yaml when present
- [ ] scanRegistry falls back to dynamic scan when no index file

### `tests/core/registry-search.test.ts`

**Tokenization and scoring:**
- [ ] single token matches name substring
- [ ] multiple tokens require AND (all must match somewhere)
- [ ] exact name match scores highest
- [ ] tag match scores higher than description match
- [ ] case-insensitive matching
- [ ] results sorted by score descending
- [ ] ties broken alphabetically by name
- [ ] no results for query with zero matches
- [ ] query token that matches nothing in any field excludes entity

### `tests/commands/search.test.ts`

- [ ] search outputs matching entities with add commands
- [ ] search --registry filters to one registry
- [ ] search --type filters by entity type
- [ ] search --json outputs valid JSON
- [ ] search with no registries shows guidance message
- [ ] search with never-updated registry skips with message
- [ ] search with stale registry shows warning

### `tests/commands/registry-update.test.ts`

- [ ] registry update clones/fetches and builds index
- [ ] registry update with name updates only that registry
- [ ] registry update shows entity counts

### `tests/commands/info.test.ts`

- [ ] info shows entity details from index
- [ ] info shows "not found" for unknown entity
- [ ] info shows multiple matches across registries

### `tests/commands/index.test.ts`

- [ ] index generates skillkit-index.yaml from local filesystem
- [ ] index --check exits 0 when up to date
- [ ] index --check exits 1 when stale
