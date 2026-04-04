# Phase 1: Foundation — Detailed Plan

## Goal
Project scaffolding, core type system, YAML/frontmatter parsers, and two CLI commands (`init`, `add`). No git operations, no resolution — just the data layer.

## Task Breakdown

### 1. Project Scaffolding
- `package.json` with Bun as runtime, `bin` entry for `skilltree`
- `tsconfig.json` with strict mode
- Biome config (`biome.json`) for lint + format
- Lefthook (`lefthook.yml`) for pre-commit hooks (lint, format check, type check)
- `src/cli.ts` entry point using commander
- Directory structure: `src/commands/`, `src/core/`, `tests/`

### 2. Linting & Static Analysis
- Biome: lint rules (recommended), format (tabs vs spaces — use Biome defaults: tabs)
- Strict tsconfig: `strict: true`, `noUncheckedIndexedAccess: true`, `noUnusedLocals: true`, `noUnusedParameters: true`
- Lefthook pre-commit: `bun run lint`, `bun run format:check`, `bun run typecheck`

### 3. Types Module (`src/types.ts`)
Key types:
- `EntityType`: `'skill' | 'agent'`
- `DependencyGroup`: `'prod' | 'dev'`
- `RemoteDependency`: `{ repo, path, version?, type?, name? }`
- `LocalDependency`: `{ local, type?, name? }`
- `Dependency`: `RemoteDependency | LocalDependency`
- `Manifest`: `{ name?, install_path?, sources?, dependencies, devDependencies }`
- `LockfileEntry`: `{ type, group, repo?, source?, path, version?, commit, integrity?, name?, dependencies }`
- `Lockfile`: `{ lockfile_version, packages }`
- `FrontmatterDeps`: `{ name?, description?, dependencies? }`

### 4. Frontmatter Parser (`src/core/frontmatter.ts`)
- Parse YAML between `---` delimiters at top of .md files
- Extract `dependencies` list (string array)
- Handle missing frontmatter, missing dependencies field, malformed YAML
- Return typed result

### 5. Manifest Parser/Writer (`src/core/manifest.ts`)
- Read `skilltree.yaml` → `Manifest` type
- Write `Manifest` → `skilltree.yaml`
- Validate: required fields per dep type (repo+path for remote, local for local)
- Expand `source:` shorthand to `repo:` using `sources:` map
- Validate unknown source aliases
- Handle name aliasing (`name:` field)
- Distinguish `dependencies` vs `dev-dependencies`

### 6. `skilltree init` Command (`src/commands/init.ts`)
- Create `skilltree.yaml` with defaults (`name` from directory name, empty deps)
- Append `.claude/skills/` and `.claude/agents/` to `.gitignore` if not present
- Idempotent — don't duplicate gitignore entries

### 7. `skilltree add` Command (`src/commands/add.ts`)
- Flags: `--repo`, `--source`, `--path`, `--version`, `--local`, `--dev`, `--type`
- `--repo` and `--source` mutually exclusive
- `--repo`/`--source` and `--local` mutually exclusive
- Default version: `"*"` when `--version` omitted
- Validate `--local` path exists at add-time
- Overwrite existing entry with warning
- Write updated manifest

## Dependencies (npm)
- `commander` — CLI framework
- `yaml` — YAML parse/stringify
- Dev: `@biomejs/biome`, `lefthook`, `@types/bun`
