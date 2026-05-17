# Phase 1 — Short Memory

## Baseline metrics

Captured before any Phase 1 edits, against branch `resolve-issue-84` at HEAD `d81e862`:

```
$ bun test tests/commands/check.test.ts tests/commands/check-publish.test.ts
47 pass, 0 fail across 2 files
```

Regression gate: this exact count must hold after `runCheck` extraction (Task 2).

## Stubs to implement

- [ ] `src/types.ts` — add `CheckStatus`, `CheckResult`, `CheckSummary` types
- [ ] `src/commands/check.ts` — add `collectCheckIssues(manifest, dir): Promise<CheckSummary>`
- [ ] `src/commands/check.ts` — refactor `checkCommand` to call `collectCheckIssues` (no user-visible change)
- [ ] `src/commands/targets.ts` — add `TargetResolution` interface
- [ ] `src/commands/targets.ts` — add `resolveTargets(targets): TargetResolution[]`
- [ ] `tests/commands/run-check.test.ts` — 4 cases
- [ ] `tests/core/resolve-targets.test.ts` — 6 cases

## Naming decisions

- `collectCheckIssues` (not `runCheck`) to avoid visual collision with the local test helper named `runCheck` in `tests/commands/check.test.ts`. Verb+object matches `lintAsymmetricPublish`, `lintLocalFrontmatter`.
- `resolveTargets` (plural) sits alongside `resolveTarget` (singular, throwing) in `src/core/agents.ts` — but lives in `src/commands/targets.ts` next to the other target-list logic. May relocate to `src/core/targets.ts` in Phase 2 if doctor wants it from core.

## Decisions deferred to Phase 2

- Where `resolveTargets` lives long-term — keep in `src/commands/targets.ts` for now; Phase 2 may move to `src/core/`.
- Whether `collectCheckIssues` should return raw `ResolvedEntity` info (richer) or pre-formatted strings (matches current). Currently spec'd as pre-formatted strings — same as `lintAsymmetricPublish` already returns.
