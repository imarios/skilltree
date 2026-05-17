# Phase 2 — Retrospective

Date: 2026-05-17
Status: ✅ COMPLETE
Test gate: 1362/1362 (was 1347; +14 doctor + 1 help-snapshot row).

## What went well

- **Phase 1's foundation paid off.** `collectCheckIssues` and `resolveTargets` plugged straight in; per-check helpers in `doctor.ts` are 5–15 lines each.
- **Single-shot lint reuse.** Calling `collectCheckIssues` once and feeding both `lint` and `frontmatter` rows from the same result avoided double-traversal.
- **Pure-function split.** `runDoctor` returns data; `doctorCommand` is the only thing that touches stdout and `process.exit`. Made tests trivial — most assert on the structured report.
- **TDD red→green clean.** 14 tests written first; one implementation pass turned them all green; full suite stayed green after.
- **`/double-check-edits`-style self-review via biome --write** caught import-grouping and `commit:` field omissions in fixtures.

## What was harder than expected

- **Lockfile fixtures need `commit: "HEAD"` even for local entries.** `LockfileEntry.commit` is non-optional. First test run failed to write because `serializeLockfile` accepted my missing field at runtime but the test fixtures were less complete than the production lockfile would be. Lesson: lockfile shape is more rigid than its TS type implies; check the existing test fixtures (`tests/core/lockfile-diff.test.ts`) before authoring new ones.
- **Skill-freshness test caught a real omission.** `commands.md` (in the bundled `skilltree` skill) wasn't on my "things to update" list. The freshness test surfaced it immediately. Good safety net — added to the Phase 3 SHORT_MEMORY checklist.

## Plan adjustments for Phase 3

- Phase 3 must also update `skills/skilltree/references/commands.md` with `--json` and `--global` flag documentation.
- Phase 3 stub-replacement: the `registry-reachability` check transitions from `skip` to a real network check. Tests must mock `git ls-remote` (probably via a function-pointer indirection in the doctor module or by injecting an executor). Plan to introduce a small `ReachabilityProbe = (url: string) => Promise<Status>` injectable.
- Phase 3 will also update the help snapshot once flags are added — note in SHORT_MEMORY.

## Hardening notes

- 8 hypotheses checked, all safe:
  H1 `_opts` unused (intentional), H2 multi-check throws (isolated), H3 lintError/summary exclusivity (mutually exclusive set paths), H4 `process.exit` in async (test mock pattern), H5 column width (24 covers longest name), H6 color leakage into Commander snapshot (separate channel), H7 empty `checks` (always 6 pushed), H8 stub object reuse (acceptable as-is).
- P0 security review: read-only, no exec/spawn, no auth surface, no secrets. Phase 3 will introduce `git ls-remote` — the one network call.

## Carry-forward to Phase 3

- `runDoctor(dir, opts)` accepts `opts: DoctorOptions { json?, global? }` — Phase 3 wires them.
- `renderDoctor(report)` is exported — Phase 3 will add `renderDoctorJson(report)` alongside.
- Underscore-prefixed `_opts` in `runDoctor` must be renamed to `opts` in Phase 3 when actually consumed.
- New per-check helper signature pattern (`(...) => CheckResult` or `Promise<CheckResult>`) is the contract for the new `checkRegistryReachability` impl in Phase 3.
