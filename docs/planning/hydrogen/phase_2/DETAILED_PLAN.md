# Phase 2: Git + Resolution — Detailed Plan

## Goal
Git operations (clone, fetch, tags), semver constraint resolution, dependency graph with transitive resolution, topological sort, and lockfile generation. This is the hardest phase — the resolver is the core value of skilltree.

## Task Breakdown

### 1. Git Client (`src/core/git.ts`)
- Clone bare repos to `~/.skilltree/cache/{host}/{owner}/{repo}/`
- Fetch updates on existing cached repos
- List tags from a cached repo
- Read file content at a specific tag/commit
- List directory contents at a specific tag/commit
- Handle repos with no semver tags (warn, use default branch HEAD)
- Normalize repo URLs (strip trailing .git, protocol prefixes for cache path)

### 2. Semver Resolution (`src/core/resolver.ts`)
- Parse git tags into semver versions (handle `v` prefix)
- Filter non-semver tags
- Given a list of tags and a constraint, find highest satisfying version
- Intersect multiple constraints on the same repo
- Error on incompatible constraints with clear message

### 3. Dependency Graph (`src/core/graph.ts`)
- Composite keys: `skill:name` or `agent:name`
- Growing resolution context (Decision #4): once resolved, available to all subsequent lookups
- Transitive resolution priority: manifest → context → same-repo → error
- Type inference: SKILL.md present = skill, single .md = agent
- Type constraints: skills can only depend on skills
- Self-reference filtering
- Batch error collection (collect all errors, report at once)

### 4. Topological Sort (Kahn's Algorithm)
- Build adjacency list from graph
- Calculate in-degrees
- Process zero-in-degree nodes in sorted order (deterministic — sort alphabetically)
- Detect cycles (nodes remaining after algorithm completes)

### 5. Lockfile Generation (`src/core/lockfile.ts`)
- Build lockfile from resolved graph
- Sort keys alphabetically for merge-conflict minimization
- Serialize to YAML with header comment
- Parse existing lockfile

### 6. Orchestration
- Wire graph construction + resolution + sort into a single `resolve()` function
- Group assignment (Decision #11): transitive dep reachable from both groups → prod

## Key Dependencies
- `simple-git` — git operations
- `semver` — version parsing and constraint satisfaction
