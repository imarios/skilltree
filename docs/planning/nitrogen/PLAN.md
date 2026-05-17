# Nitrogen — Preflight Doctor

Project-Type: production
Sub-Project: Nitrogen (started 05/17/2026)

Spec: [docs/specs/doctor.md](../../specs/doctor.md) (v1.0)

Resolves issue #84 (closes on merge of final PR). Part of Authoring UX v1 (#78); referenced from #77.

## Project shape

Three sequential phases. Phase 1 is a no-behavior-change refactor that lifts each existing check out of its CLI wrapper so doctor can call them as plain functions. Phase 2 wires the orchestrator and text renderer. Phase 3 adds the JSON contract, `--global`, and registry reachability.

```
Phase 1: foundation — extract each check as a callable function
  validateManifestOrThrow │ runCheck │ diffManifestLockfile │ resolveTargets
       │ (no behavior change; pure refactor + tests)
       ↓
Phase 2: doctor orchestrator + text renderer + exit codes
  src/commands/doctor.ts, CLI wiring, ✔/✘/⚠ rendering, exit 0/1
  Lands acceptance criteria 1–3 (fresh passes, broken lockfile fails, malformed SKILL.md fails)
       ↓
Phase 3: --json + --global + registry reachability
  Stable JSON schema (snapshot), --global, git ls-remote with 5s timeout, read-only invariant test
```

Phases ship together as a single PR closing #84 (per sir's instruction). Per-phase commits are kept clean for review.

## Phase 1: Foundation — extract checks as callable functions ✅ COMPLETE
<!-- Spec: doctor.md D5–D10 -->

Refactor existing checks so each is a pure function returning a standard `CheckResult`. No CLI behavior change; existing `skilltree check` continues to print the same output.

### Tasks
- [x] Define `CheckStatus`, `CheckResult`, `CheckSummary` types in `src/types.ts`. (D16–D19)
- [x] Extract `collectCheckIssues(manifest, dir)` from `src/commands/check.ts` — returns `CheckSummary` instead of printing. CLI wrapper (`checkCommand`) is now a thin renderer over it. Output and exit codes preserved. (D6, D10)
- [x] Add `resolveTargets(targets): TargetResolution[]` to `src/commands/targets.ts` — non-throwing wrapper that probes literal paths with `fs.stat`. (D8)
- [x] Verified `validateManifest` (`src/core/manifest.ts:351`) and `diffManifestLockfile` (`src/core/lockfile.ts:241`) are already callable as pure functions. No work needed.
- [x] Regression guard: `tests/commands/check*.test.ts` 47/47 pass unchanged.
- [x] New tests (`tests/commands/run-check.test.ts` 4 cases + `tests/core/resolve-targets.test.ts` 6 cases) — 10/10 green.
- [x] `bun test` green: 1347/1347 (was 1337; +10 new). `tsc --noEmit` clean. `biome check` clean.

### Per-phase DoD additions
- [x] Existing `skilltree check` golden-output tests unchanged — refactor invisible to users.

## Phase 2: Doctor orchestrator + text renderer + exit codes
<!-- Spec: doctor.md D1, D3–D6, D11–D15, D20–D22 -->

Ship the `doctor` command in text mode. Cover acceptance criteria 1–3 from the issue.

### Tasks
- [ ] New file `src/commands/doctor.ts`: `doctorCommand(opts)` orchestrator. Calls D5/D6/D7/D8/D10 in order (D9 deferred to Phase 3, replaced with a `skip` row that says "deferred").
- [ ] Per-check error isolation: a thrown exception inside one check becomes `status: "fail"` with `detail: err.message`; other checks still run. (Error Handling)
- [ ] Text renderer: aligned two-column table using the `printTable` helper from `src/ui/` (commit b03fe31). Status symbols `✔ ✘ ⚠ –`. Fix line indented under failures with `→`. (D11–D14)
- [ ] Footer line summarizing fail + warn counts. Colors honor existing `NO_COLOR` / TTY conventions. (D14–D15)
- [ ] Exit code: `1` if any `fail`, else `0`. (D20–D21)
- [ ] CLI wiring in `src/cli.ts` (commander subcommand). Help text lists checks + lifecycle position. (D3–D4)
- [ ] Tests: clean-project pass (acceptance #1), broken-lockfile fail (acceptance #2), malformed-SKILL.md fail (acceptance #3), per-check exception isolation, exit-code matrix.
- [ ] Help-snapshot test updated; completion table updated; commands.md updated.
- [ ] `bun test` green. `tsc` + biome clean.

### Per-phase DoD additions
- Manual smoke: run `skilltree doctor` against this repo and capture the output in `SHORT_MEMORY.md`. Must be readable and aligned in a 100-column terminal.

## Phase 3: --json + --global + registry reachability
<!-- Spec: doctor.md D2, D9, D16–D19, D23–D24 -->

Round out the surface: machine-readable output, global-manifest mode, the one network check, and the read-only invariant test.

### Tasks
- [ ] `--json` flag emits the documented JSON shape. Snapshot test asserts shape stability. (D16–D19, D22)
- [ ] `--global` flag: switches to `~/.skilltree/global.yaml`; project-scoped checks (lockfile, targets) emit `status: "skip"` rather than running. (D2)
- [ ] Registry reachability (D9): for each registry in `~/.skilltree/config.yaml`, run `git ls-remote` with a 5s timeout. Reuse any existing timeout wrapper in `src/core/git.ts`. Warn on auth-required and on timeout; do not fail. (D9, Error Handling rows)
- [ ] Read-only invariant test (D23): snapshot mtimes of every file under cwd before invocation, run `doctor`, assert no mtime changes. Covers all flag combos.
- [ ] Tests: `--json` schema snapshot, `--global` skip behavior, unreachable registry → warn (mock `git ls-remote`), auth-required → warn, timeout → warn, identical exit codes between text and json modes.
- [ ] Update help text + completion + commands.md to document `--json` and `--global`.
- [ ] `bun test` green. `tsc` + biome clean.

### Per-phase DoD additions
- Manual smoke against a real registry list (run on sir's machine, not CI) to confirm the 5s timeout actually fires when a registry is offline. Documented in `SHORT_MEMORY.md`.

## Project-level deliverables (across all phases)

- [ ] Single PR closing #84 (per sir's instruction).
- [ ] `README.md` "Authoring workflow" section mentions the lifecycle: `new → check → doctor → git tag`.
- [ ] `BACKLOG.md` reviewed — anything discovered during work goes here or to a fresh GitHub issue.
- [ ] Project completion: walk D1–D24, verify every requirement is satisfied or moved to BACKLOG with justification.
- [ ] Project retrospective at `docs/planning/nitrogen/RETRO.md`.

## Nitrogen — Sub-project Status

Phase 1: ✅ COMPLETE
Phase 2: ⏳ PENDING
Phase 3: ⏳ PENDING
