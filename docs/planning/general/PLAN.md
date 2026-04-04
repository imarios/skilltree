# General - Cross-Project Work

Project-Type: production
Sub-Project: general

## Phase 1: Test Coverage to 95% ✅ COMPLETE

Brought line coverage from 71% to 95% (excluding llm.ts API wrapper). Fixed orphan cleanup bug in remove.ts.

### Tasks
- [x] `src/core/git.ts` (21% → 92%) — test git operations using local bare repo fixtures
- [x] `src/core/graph.ts` (58% → 87%) — test remote resolution paths, same-repo transitive lookup
- [x] `src/core/installer.ts` (64% → 91%) — test git cache copy, verify modified/ok status, force overwrite
- [x] `src/commands/remove.ts` (28% → 88%) — test orphan cleanup, dependents warning, --keep-files, transitive-only error. Fixed bug: orphan file cleanup was reading entry after deleting it.
- [x] `src/core/llm.ts` (2% → 22%) — exported parseEntityList for unit testing. API call paths untestable without credentials (excluded from 95% target).
- [x] `src/core/scanner.ts` (71%) — tested applyToFrontmatter edge cases. scanFileWithLlm excluded (calls llm.ts API).
- [x] `src/commands/migrate.ts` (86% → 99%) — tested agent detection, installed entities without aipm record

## Phase 2: End-to-End Tests ✅ COMPLETE

Realistic integration tests that create actual git repos, run real commands, and verify installed files, lockfiles, and dependency graphs.

### Tasks
- [x] Install e2e tests — remote skill, mixed local+remote, cross-repo transitive, same-repo auto-resolution, --prod, --install-path, --dry-run, idempotent re-install, lockfile-first optimization (9 tests)
- [x] Update e2e tests — update all, selective update, no lockfile, --dry-run, local dep with new transitive, non-existent dep (6 tests)
- [x] Lifecycle e2e test — init → add → install → verify → update → remove → verify (1 test, 21 assertions)
- [x] Edge case e2e tests — diamond deps, mixed skill+agent, version conflict, --prod --frozen --install-path, orphan cascade, tagless repo, re-install after remove, deep cross-repo chain, empty manifest (10 tests)
