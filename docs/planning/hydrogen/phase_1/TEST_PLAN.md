# Phase 1: Foundation — Test Plan

## Frontmatter Parser (`tests/core/frontmatter.test.ts`)

### Positive
- [x] Parse valid frontmatter with name, description, dependencies
- [x] Parse frontmatter with dependencies only
- [x] Parse empty frontmatter (just `---\n---`)
- [x] Parse frontmatter with extra fields (ignored)

### Negative
- [x] Return null for content with no frontmatter
- [x] Throw on malformed frontmatter (missing closing `---`)
- [x] Handle non-string dependency entries (filter out)

## Manifest Parser (`tests/core/manifest.test.ts`)

### Positive
- [x] Parse manifest with remote dependencies
- [x] Parse manifest with local dependencies
- [x] Parse manifest with source shorthands
- [x] Parse manifest with both dependency groups
- [x] Parse manifest with name aliasing (name field)
- [x] Serialize manifest to YAML and re-parse roundtrip

### Validation
- [x] Error: missing repo/local on dependency
- [x] Error: repo and local both present
- [x] Error: remote dep missing path
- [x] Error: same key in both groups

### Source Expansion
- [x] Expand source alias to repo URL
- [x] Error on unknown source alias

## Init Command (`tests/commands/init.test.ts`)

### Positive
- [x] Create skilltree.yaml with project name from directory
- [x] Append to existing .gitignore without duplicating entries
- [x] Create .gitignore if it doesn't exist

### Idempotency
- [x] Don't duplicate gitignore entries on second run

## Add Command (`tests/commands/add.test.ts`)

### Positive
- [x] Add remote dependency with repo, path, version
- [x] Add remote dependency with source shorthand
- [x] Add local dependency
- [x] Add dev dependency
- [x] Default version to "*" when omitted

### Negative
- [x] Error: --repo and --source together
- [x] Error: --repo and --local together
- [x] Error: no --repo/--source/--local
- [x] Error: remote dep without --path
- [x] Error: local path doesn't exist
- [x] Error: name exists in other group
- [x] Warn on overwrite in same group
