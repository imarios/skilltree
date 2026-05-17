# Project Retrospective — Nitrogen (Preflight Doctor)

Date: 2026-05-17
Sub-project: Nitrogen
Issue: #84
Same-session LightningMode across all 3 phases.

## What worked well

- **Phase 1 as honest foundation.** The pure-refactor phase felt almost trivial in isolation (~80 LOC source + 130 LOC tests), but it paid for itself in Phase 2 where the orchestrator became 8 lines of `checks.push(...)` calls. Without Phase 1, Phase 2 would have either duplicated `collectCheckIssues`'s logic inline or coupled doctor to `checkCommand`'s printing.
- **Pure orchestrator + thin CLI wrapper split.** `runDoctor` returns data; `doctorCommand` is the only place that touches stdout and `process.exit`. Made the tests trivial — most assert on the structured report and never touch the renderer.
- **Probe injection for the one network call.** Making `ReachabilityProbe` a parameter (not a module setter) kept the orchestrator a pure function, kept tests fast (no real network), and the production binding is a one-liner `probe = opts.probe ?? lsRemote`.
- **TDD red→green clean every phase.** Each phase wrote tests first, saw them fail with explicit "missing export" or "expected X got Y" errors, then implemented to green. The Phase 1 literal-path detection bug (using `target !== resolvedPath` instead of `isLocalSource(target)`) was caught by test 1 of 6 — would have shipped silently without TDD.
- **Spec → DETAILED_PLAN → TEST_PLAN → SHORT_MEMORY → code → RETRO ceremony at every phase.** Even in LightningMode, no phase skipped. The DETAILED_PLAN's "current state survey" table for Phase 1 caught that `lintAsymmetricPublish` and `lintLocalFrontmatter` were already pure functions — saving an unnecessary extraction.

## What didn't work well

- **Tests bled to real network.** First Phase 3 run hit `~/.skilltree/config.yaml` (7 registries) and took 50s wall-clock. Should have shipped `runDoctorIsolated` in the *same commit* as the reachability code, not after the first failed test run. Test isolation is a feature of the production code; treat it as a Phase 3 task, not a Phase 3 firefight.
- **Lockfile-fixture shape mismatch.** First Phase 2 tests omitted `commit: "HEAD"` on local lockfile entries — runtime worked but `serializeLockfile` produced a YAML that `parseLockfile` would later choke on (uncovered when I scaled the fixture). Lesson: copy lockfile fixtures from `tests/core/lockfile-diff.test.ts` rather than hand-rolling them.
- **`expect.toContain` typing surprise.** `expect(["pass", "skip"]).toContain(maybeUndefined)` compiles only at runtime; tsc rejects. Three tests rewritten to `expect(x).not.toBe("fail")` which is stronger anyway. Worth a CLAUDE.md note: prefer negative assertions on union types over positive `toContain`.

## Late discoveries that should have been caught earlier

- **`skilltree check` was missing from the README Commands table.** Discovered while updating README in Phase 2 cycle 080. Not a Nitrogen bug — preexisting omission — but worth recording: the "skill freshness" test catches commands.md drift but not README drift. A second freshness test would close that gap.
- **`global.yaml` vs `global.yml` deprecation.** My Phase 3 fixture used `.yaml`, triggering a deprecation warning at test time. Renamed to `.yml`. Suggests the deprecation should eventually escalate to an error so new code stops introducing the deprecated form.

## Process improvements for future projects

1. **Test isolation ships with the network-touching code.** Treat the "tests don't hit my home dir" hook as a feature, not an afterthought. Should be in the same commit as the network call it isolates.
2. **Lockfile fixtures live in a helper.** Phase 2 should have introduced a `tests/helpers/lockfile-fixtures.ts` with `localEntry(name)` etc. Doing it ad-hoc per test invites the shape-mismatch class of bug. Candidate for a follow-up cleanup.
3. **Prefer canonical predicates.** Two phases hit a variation of "I rolled my own check when the codebase already had one" — Phase 1's `target !== resolvedPath` instead of `isLocalSource(target)`, Phase 3's stderr-text auth check (existing tooling might have a richer detector). CLAUDE.md already calls this out in the "canonical-identity helper" pattern; reinforce via a phase-020 step in DETAILED_PLAN: "list the existing helpers your phase will need; flag any you'd be tempted to re-derive."

## Methodology feedback

- The 3-cycle-per-phase (020 plan → 030 test plan → 040 tests → 050 impl → 060 hardening → 080 readme → 090 finalize → 095 retro → 100 commit) felt right for a 3-phase project. Roughly 30 min per phase on the cycles I executed (sans tool wait time).
- LightningMode held its TDD discipline because the spec was complete and the phases were well-scoped. If either had been weak, the autonomous flow would have produced more rework. Worth saying out loud: **LightningMode is a force multiplier on a solid PLAN, not a substitute for one.**
- The "current state survey" sub-step in each Phase's DETAILED_PLAN (looking at existing functions before deciding what to extract) added maybe 5 minutes per phase and saved at least one full phase of unnecessary refactoring across the project. Worth promoting from convention to checklist.

## Carry-forward to the next sub-project

- Use Phase 1's CHECK_STATUS / CHECK_RESULT types directly — they're already in `src/types.ts` and shared CLI surface.
- Use `lsRemote` from `src/core/git.ts` for any future read-only network probe (e.g., a future `skilltree outdated --remote` that checks tag freshness).
- The probe-injection pattern is the template for any future network-touching command that needs unit tests.
