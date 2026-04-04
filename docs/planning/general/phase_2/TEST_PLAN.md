# Phase 2 Test Plan: End-to-End Tests

## Goal
Write realistic end-to-end tests that create actual git repos with files, run real commands, and verify installed files, lockfiles, and dependency graphs are correct.

## Test Files

### 1. tests/e2e/install-e2e.test.ts
Full `installCommand` flows with real git repos + local deps.

- [x] Remote skill install: Create git repo with tagged skill → install → verify files in .claude/skills/, lockfile with version + commit + integrity
- [x] Mixed local + remote install: Local skill + remote skill → verify symlinks for local, copies for remote
- [x] Cross-repo transitive deps: Repo A skill depends on skill in Repo B → install → both resolved
- [x] Same-repo transitive auto-resolution: Only parent declared, child auto-discovered
- [x] --prod skips dev deps: Dev + prod deps → --prod → only prod installed
- [x] --install-path copies local deps: Local dep → custom install-path → copies not symlinks
- [x] --dry-run: No files written, no lockfile created
- [x] Idempotent re-install: Install twice → same result
- [x] Lockfile-first: Second install logs "Lockfile is current"

### 2. tests/e2e/update-e2e.test.ts

- [x] Update all: v1.0.0 → add v2.0.0 tag → update → lockfile shows v2.0.0
- [x] Selective update: Two repos, update one → only that repo re-resolved
- [x] Update with no lockfile: Equivalent to fresh install
- [x] Update --dry-run: Shows plan, no lockfile change
- [x] Update local dep with new transitive: Re-reads frontmatter

### 3. tests/e2e/lifecycle-e2e.test.ts

- [x] init → add → install → verify → update → remove → verify

### 4. tests/e2e/edge-cases-e2e.test.ts

- [x] Diamond dependency through remote repos
- [x] Mixed skill + agent graph
- [x] Version conflict → clear error
- [x] --prod --frozen --install-path combined (CI sim)
- [x] Remove with orphan cascade
- [x] Tagless repo fallback with warning
