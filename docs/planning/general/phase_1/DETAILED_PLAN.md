# General Phase 1: Test Coverage to 95% — Detailed Plan

## Goal
Raise line coverage from 71% to 95% by testing all untested code paths.

## Approach
- Use local bare git repos as fixtures (no network) for git.ts and remote graph paths
- Mock Anthropic SDK for llm.ts
- Test each uncovered branch identified in the coverage report

## File-by-file plan

### 1. git.ts (21% → 95%)
- `repoCachePath` — normalize various URL formats (https, git@, trailing .git)
- `ensureCached` — clone fresh + fetch existing (using local file:// repos)
- `listTags` — list tags from a bare repo
- `readFileAtRef` — read file content at a tag
- `listDirAtRef` — list directory at a tag
- `getCommitSha` — get SHA for a ref
- `getDefaultBranch` — get HEAD branch name

### 2. graph.ts (58% → 90%)
- Remote entity resolution (using local git fixture as repo)
- Tagless repo warning path
- Same-repo transitive lookup
- Incompatible version constraints error
- Git operation failure error
- Name aliasing through resolution

### 3. installer.ts (64% → 95%)
- `copyFromGitCache` — copy files from bare repo at ref
- `copyTreeFromGit` — recursive tree copy
- `verifyInstalled` — ok status for matching integrity
- `verifyInstalled` — modified status for changed files
- `executeInstall` — force overwrite existing non-symlink

### 4. remove.ts (28% → 95%)
- Remove with dependents warning (no --force)
- Orphan cleanup (cascading)
- `--keep-files` flag
- Transitive-only dep error
- Remove with lockfile update

### 5. llm.ts (2% → 80%)
- Mock Anthropic client
- Test extractCandidates prompt construction
- Test verifyCandidates prompt construction
- Test parseJsonResponse with valid/invalid/markdown-wrapped JSON
- Test missing API key error

### 6. scanner.ts (71% → 95%)
- `scanFileWithLlm` integration (mocked)
- `applyToFrontmatter` — no existing deps, empty frontmatter

### 7. migrate.ts (86% → 95%)
- Detect agents in agents/source/ directory
- Installed entities without aipm record
- Installed agents detection
