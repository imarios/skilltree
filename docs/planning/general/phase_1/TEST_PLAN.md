# General Phase 1: Test Coverage — Test Plan

## git.ts

- [ ] repoCachePath normalizes https:// URL
- [ ] repoCachePath normalizes git@ URL
- [ ] repoCachePath strips trailing .git
- [ ] ensureCached clones a new repo
- [ ] ensureCached fetches existing cached repo
- [ ] listTags returns all tags
- [ ] readFileAtRef reads file at a tag
- [ ] listDirAtRef lists directory at a tag
- [ ] getCommitSha returns SHA for a tag
- [ ] getDefaultBranch returns branch name

## graph.ts (remote paths)

- [ ] resolves remote deps from a local git fixture repo
- [ ] resolves transitive deps from same repo (same-repo default)
- [ ] reports error for unresolvable transitive dep from remote

## installer.ts

- [ ] copyFromGitCache copies skill directory from bare repo
- [ ] verifyInstalled reports ok for matching integrity
- [ ] verifyInstalled reports modified for changed content
- [ ] executeInstall with --force overwrites existing directory

## remove.ts

- [ ] warns about dependents without --force
- [ ] orphan cleanup removes unreachable transitive deps from lockfile
- [ ] --keep-files leaves installed files in place
- [ ] errors on transitive-only dep removal

## llm.ts

- [ ] throws on missing ANTHROPIC_API_KEY
- [ ] parseJsonResponse extracts valid JSON array
- [ ] parseJsonResponse handles markdown-wrapped JSON
- [ ] parseJsonResponse returns empty for invalid JSON
- [ ] parseJsonResponse filters non-conforming objects

## scanner.ts

- [ ] applyToFrontmatter handles file with no existing deps
- [ ] applyToFrontmatter handles empty frontmatter

## migrate.ts

- [ ] detects agents in agents/source/ directory
- [ ] detects installed entities without aipm record
- [ ] detects installed agents
