# Project Completion Summary — Nitrogen

Date: 2026-05-17
Resolves: issue #84

## Specs Delivered

- `docs/specs/doctor.md` (v1.0) — Fully implemented across Phases 1–3.

### Spec-to-phase traceability (D1–D24)

| Req | Phase | Coverage |
|---|---|---|
| D1 (`skilltree doctor` invocation) | 2 | CLI subcommand in `src/cli.ts` |
| D2 (`--json`, `--global` flags) | 3 | `src/cli.ts` + `DoctorOptions` |
| D3 (help text lists checks) | 2 | Subcommand description in `src/cli.ts` |
| D4 (help text mentions lifecycle) | 2 | Description includes `new → check → doctor → git tag` |
| D5 (manifest-schema via `validateManifest`) | 1 (helper) + 2 (orchestrator) | `checkManifestSchema` |
| D6 (lint via `collectCheckIssues`) | 1 (extraction) + 2 (orchestrator) | `checkLint` |
| D7 (lockfile-sync via `diffManifestLockfile`) | 2 | `checkLockfileSync` |
| D8 (target-consistency via `resolveTargets`) | 1 (helper) + 2 (orchestrator) | `checkTargetConsistency` |
| D9 (registry-reachability via `git ls-remote` + 5s timeout) | 3 | `lsRemote` + `checkRegistryReachability` |
| D10 (frontmatter from same lint scan) | 1 (helper) + 2 (orchestrator) | `checkFrontmatter` reuses `summary` |
| D11 (aligned table) | 2 | `renderDoctor` |
| D12 (status symbols ✔ ✘ ⚠ –) | 2 | `STATUS_GLYPH` map |
| D13 (indented `→ fix` under failures) | 2 | `renderDoctor` |
| D14 (footer with counts) | 2 | `renderDoctor` |
| D15 (NO_COLOR honored) | 2 | Inherits `pc` (picocolors) which honors `NO_COLOR` |
| D16–D19 (JSON shape) | 3 | `renderDoctorJson`, `CheckResult` type |
| D20–D21 (exit codes 0/1) | 2 | `doctorCommand` calls `process.exit(1)` on fail |
| D22 (exit codes identical text/json) | 3 | `doctorCommand` branches only on renderer |
| D23 (read-only: no writes) | 2 (design) + 3 (test) | RO1 / RO2 tests |
| D24 (no fetch/clone) | 2 (design) + 3 (verified) | `lsRemote` uses `git ls-remote` only |

All 24 requirements implemented. No deferred or dropped requirements.

## Spec open questions — resolutions

- **Q1** (does `--global` skip registry-reachability?) — **Resolved NO** (kept always-on). Reachability uses the global config regardless of manifest scope.
- **Q2** (does footer count `skip` entries?) — **Resolved NO** (footer counts only fail + warn; the pass-mode footer mentions skipped count parenthetically).
- **Q3** (add a `--check <name>` filter in v1?) — **Deferred** to BACKLOG. Not customer-requested; cheap to add later.

## Deferred Items

Nothing required for this project was deferred. Two operational follow-ups documented in Phase 3 RETRO:

- Locale-sensitive auth-failure heuristic in `lsRemote` (current heuristic checks English git stderr; non-English locales fall through to `reason: "other"` with the raw error string preserved). Low priority — degradation is graceful.
- RO3 mtime test for `--global` mode (current RO tests cover text + JSON modes against a project dir; global-mode read-only is exercised by G* tests but not via a strict mtime snapshot). Low priority — global mode shares the same code path as text mode.

Both candidates for BACKLOG.md or fresh GitHub issues.

## Dropped Requirements

None.

## Open BACKLOG Items

No new items required by this project. Existing BACKLOG.md unchanged.

## Tests

- Phase 1: +10 (`collectCheckIssues`, `resolveTargets`)
- Phase 2: +14 (`doctorCommand` text mode, acceptance criteria 1–3)
- Phase 3: +20 (json, global, reachability, read-only invariant)

Total: +44 tests. Suite went from 1337 (project start) → 1382 (project close). Net delta is +45 because one help-snapshot row was added.

## Code

- `src/types.ts` — `CheckStatus`, `CheckResult`, `CheckSummary` types added.
- `src/commands/check.ts` — `collectCheckIssues` extracted.
- `src/commands/targets.ts` — `resolveTargets` + `TargetResolution` added.
- `src/commands/doctor.ts` — new file, 380 lines (orchestrator + 6 checks + 2 renderers).
- `src/core/git.ts` — `lsRemote` + `LsRemoteOutcome` added (75 lines).
- `src/cli.ts`, `src/commands/completion.ts` — CLI wiring.
- `skills/skilltree/references/commands.md`, `README.md` — user-facing docs.

## Final commit chain on branch `resolve-issue-84`

```
a909e70 feat(doctor): --json, --global, registry reachability (#84)
889aa56 feat(doctor): preflight health check command (#84)
a4467dd refactor(check): extract collectCheckIssues + resolveTargets (#84)
d81e862 bump: version 0.29.2 → 0.29.3   (← main, project baseline)
```
