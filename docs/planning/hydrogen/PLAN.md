# Hydrogen - Core Dependency Manager

Project-Type: production
Sub-Project: Hydrogen (started 03/29/2026)

## Phase 1: Foundation ✅ COMPLETE

Project setup and core parsing. No git, no resolution — just the data layer and two CLI commands.

### Tasks
- [x] Project scaffolding (package.json, tsconfig.json, Bun config, src/ structure)
- [x] Linting and static analysis — Biome (lint + format), strict tsconfig
- [x] Pre-commit hooks — lefthook with lint, format check, and type check on staged files
- [x] Types module (`src/types.ts`) — Manifest, LockfileEntry, Dependency, EntityType, etc.
- [x] SKILL.md frontmatter parser (`src/core/frontmatter.ts`) — extract `dependencies` list from YAML frontmatter
- [x] Manifest parser/writer (`src/core/manifest.ts`) — read/write `skilltree.yaml`, validate fields, expand source shorthands, handle name aliasing
- [x] `skilltree init` command — create `skilltree.yaml`, update `.gitignore`
- [x] `skilltree add` command — add remote, local, dev deps; `--repo`, `--source`, `--path`, `--version`, `--local`, `--dev` flags; duplicate-name overwrite with warning; validate local path exists

## Phase 2: Git + Resolution ✅ COMPLETE

Git operations and the dependency resolver. The hardest phase — constraint solving, transitive resolution, topological sort.

### Tasks
- [x] Git client (`src/core/git.ts`) — clone bare repos to `~/.skilltree/cache/`, fetch, list tags, checkout content at tag/commit
- [x] Semver resolution (`src/core/resolver.ts`) — parse tags, filter semver-valid, intersect constraints from multiple manifest entries on same repo, find highest satisfying tag
- [x] Dependency graph (`src/core/graph.ts`) — composite keys (`type:name`), growing resolution context, transitive resolution priority (manifest → context → same-repo → error)
- [x] Topological sort (Kahn's algorithm) — deterministic ordering, cycle detection
- [x] Validation — batch error collection: missing deps, broken chains, cycles, type constraints (skill→skill only), self-reference filtering
- [x] Lockfile writer (`src/core/lockfile.ts`) — generate `skilltree.lock` from resolved graph
- [x] Tag-less repo handling — warn + use default branch HEAD

## Phase 3: Installation ✅ COMPLETE

The `skilltree install` command — the core user-facing workflow.

### Tasks
- [x] Installer (`src/core/installer.ts`) — copy remote deps from git cache, symlink local deps
- [x] Lockfile-first behavior — skip resolution when lockfile current, minimal resolution for manifest changes, always re-read local deps
- [x] `--prod` flag — install `dependencies` only, skip `dev-dependencies`
- [x] `--frozen` flag — lockfile-only mode, error if manifest/lockfile out of sync, error if local dep adds new transitive dep
- [x] `--force` flag — overwrite locally modified files
- [x] `--install-path` flag — override target dir, copy (not symlink) local deps, `mkdir -p` behavior
- [x] `--dry-run` flag — show install plan without writing files
- [x] Integrity hashing (`sha256`) — compute on remote deps and prod-copied local deps
- [x] Modification detection — check installed files against lockfile integrity hash before overwriting
- [x] `skilltree verify` command — report OK/MODIFIED/LINKED status per entity
- [x] Lockfile reader (`src/core/lockfile.ts`) — parse existing `skilltree.lock`
- [x] Permissions — `chmod 444` for files of remote deps

## Phase 4: Lifecycle ✅ COMPLETE

Management commands for day-to-day use.

### Tasks
- [x] `skilltree update [name]` — re-resolve versions, update lockfile, reinstall; `--dry-run` to preview
- [x] `skilltree remove <name>` — remove from manifest + lockfile + installed files; orphan cleanup (cascading); `--force` to skip confirmation; `--keep-files`; error if target is transitive-only
- [x] `skilltree deps tree` — render dependency tree with dedup markers
- [x] `skilltree list` — tabular display of installed entities (name, type, group, version, source)
- [x] `skilltree cache clean` — remove `~/.skilltree/cache/`

## Phase 5: Dependency Scanner ✅ COMPLETE

Authoring tool for detecting undeclared dependencies in skill body text.

### Tasks
- [x] Regex scanner (`src/core/scanner.ts`) — 4 battle-tested patterns from aipm (LOAD directive, "Use the X skill", backtick variant, "Load the X skill")
- [x] `skilltree scan <path>` command — detect undeclared deps, report gaps
- [x] `--check` flag — exit 0/1 for pre-commit integration
- [x] `--apply` flag — auto-update SKILL.md frontmatter with regex-detected deps
- [x] `--llm` flag — two-phase Anthropic API detection (extract + verify), results as suggestions only
- [x] `--json` flag — machine-readable output
- [x] Pre-commit hook documentation (in spec reference.md)

## Phase 6: Distribution ✅ COMPLETE

Package and ship the tool.

### Tasks
- [x] npm publish setup — package.json `bin` field, `files` field, `npx skilltree` support
- [x] Bun compile — `bun build --compile` build script in package.json
- [ ] GitHub Releases — CI workflow for tagged releases (deferred, needs repo setup)
- [x] README.md — full user-facing documentation with commands, flags, architecture
