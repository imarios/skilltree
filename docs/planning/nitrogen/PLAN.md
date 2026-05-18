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

## Phase 2: Doctor orchestrator + text renderer + exit codes ✅ COMPLETE
<!-- Spec: doctor.md D1, D3–D6, D11–D15, D20–D22 -->

Ship the `doctor` command in text mode. Cover acceptance criteria 1–3 from the issue.

### Tasks
- [x] New file `src/commands/doctor.ts`: `runDoctor` + `doctorCommand`. Calls D5/D6/D7/D8/D10 in order; D9 (`registry-reachability`) is a `skip` stub for Phase 3.
- [x] Per-check error isolation: each check is in its own try/catch; exceptions become `fail` rows; other checks keep running.
- [x] Text renderer: aligned name column + glyph + colored detail. Indented `→ fix` line under failures.
- [x] Footer line: `✔ doctor: all N checks passed (M skipped)` or `✘ doctor: N failures, M warnings`.
- [x] Exit code: `1` if any `fail`, else `0`.
- [x] CLI wiring in `src/cli.ts` (commander subcommand). Help text lists checks + lifecycle position.
- [x] Tests (`tests/commands/doctor.test.ts`): 14 cases covering acceptance #1–3, ordering, summary tally, exit codes, rendering.
- [x] Help snapshot regenerated (`tests/cli/help-snapshot.test.ts` +1 snapshot).
- [x] Completion table updated (`src/commands/completion.ts`).
- [x] Skill docs updated (`skills/skilltree/references/commands.md`).
- [x] `bun test` green: 1362/1362 (was 1347; +14 doctor + 1 snapshot). `tsc` + biome clean.

### Per-phase DoD additions
- [x] Manual smoke against this repo deferred — captured in SHORT_MEMORY as Phase 3 follow-up since Phase 2 stubs registry-reachability anyway.

## Phase 3: --json + --global + registry reachability ✅ COMPLETE
<!-- Spec: doctor.md D2, D9, D16–D19, D23–D24 -->

Round out the surface: machine-readable output, global-manifest mode, the one network check, and the read-only invariant test.

### Tasks
- [x] `--json` flag emits the documented JSON shape via `renderDoctorJson`. Snapshot test asserts shape stability (J1–J5).
- [x] `--global` flag: switches to `~/.skilltree/global.yml`; project-scoped checks (lockfile, targets) emit `status: "skip"` with detail `"global mode"`. Lint/frontmatter/reachability still run.
- [x] Registry reachability (D9): new `lsRemote(url, {timeoutMs})` helper in `src/core/git.ts` — Promise.race with setTimeout, 5s default. Auth/timeout/unreachable/other reason classification via stderr-text heuristics. Warn (not fail) on any non-ok outcome.
- [x] `ReachabilityProbe` injection on `runDoctor(dir, opts)` lets tests bypass real network.
- [x] Read-only invariant test (RO1, RO2): snapshot file mtimes pre/post, assert identical. Covers text and JSON modes.
- [x] Tests: J1–J5 (json), G1–G4 (global), R1–R6 (reachability), C1–C3 (CLI), RO1–RO2 (read-only). 20 new cases.
- [x] Network isolation: `runDoctorIsolated` wrapper + `runCli` defaults ensure no test hits the developer's `~/.skilltree/config.yaml`.
- [x] Help snapshot regenerated; completion table updated; commands.md updated; README Key Flags table updated.
- [x] `bun test` green: 1382/1382 (was 1362; +20 new). `tsc --noEmit` clean. `bunx biome check` clean.

### Per-phase DoD additions
- [ ] Manual smoke against sir's real registry list (run on sir's machine, not CI) to confirm the 5s timeout fires when a registry is offline. Deferred to manual verification after merge.

## Project-level deliverables (across all phases)

- [ ] Single PR closing #84 (per sir's instruction).
- [ ] `README.md` "Authoring workflow" section mentions the lifecycle: `new → check → doctor → git tag`.
- [ ] `BACKLOG.md` reviewed — anything discovered during work goes here or to a fresh GitHub issue.
- [ ] Project completion: walk D1–D24, verify every requirement is satisfied or moved to BACKLOG with justification.
- [ ] Project retrospective at `docs/planning/nitrogen/RETRO.md`.

## Phase 4: Resolver error attribution (extension)
<!-- Tracks: #85. Adopted 2026-05-18 after Phases 1-3 shipped. -->

Nitrogen Phases 1–3 made *preflight* diagnostics visible via `doctor`. Phase 4 extends the same philosophy to *runtime* resolver and install errors: every error names the manifest that imposed the offending constraint and the dep involved, so the author can tell which file to edit.

Three sequential sub-phases. Each ships as its own PR.

```
Phase 4.1: Catalogue + snapshot harness
  Inventory every `throw new Error` / state.errors.push site across
  src/core/{resolver,graph,installer,manifest,lockfile}.ts.
  Classify each as clear / mis-attributed / ambiguous. Add a
  snapshot harness so subsequent phases prove their changes.
  Deliverable: docs/planning/nitrogen/phase_4/error-audit.md.
       ↓
Phase 4.2: Resolver + graph attribution
  Fix the canonical mis-attribution (resolver.ts:81-84 +
  graph.ts:167-169): version-conflict errors name the manifest
  that imposed each constraint (consumer manifest vs transitive
  manifest@<ref>) and the dep being constrained. Same shape for
  cross-repo transitive conflicts (graph.ts:808).
       ↓
Phase 4.3: Collision attribution
  Fix duplicate-key resolution errors (graph.ts:252): name both
  source manifests in the collision message. Install-time path
  collisions (installer.ts:361) named likewise. Closes #85.
```

### Phase 4.1 tasks
- [ ] Worktree: `.claude/worktree/issue-85-phase-1-error-audit/`.
- [ ] Catalogue all `throw new Error` + `state.errors.push` + `state.warnings.push` sites in `src/core/{resolver,graph,installer,manifest,lockfile}.ts` and `src/commands/*.ts`. One row per site in `docs/planning/nitrogen/phase_4/error-audit.md`: file:line, current text, who-imposes-what, classification.
- [ ] Add `tests/core/error-attribution-snapshot.test.ts`: fixture-driven snapshot test that exercises each mis-attributed error site and captures the current (bad) text. Sets baseline that 4.2/4.3 will update.
- [ ] Light helper extract if obvious: e.g., `formatConstraintList(constraints)` if the shape is already shared.
- [ ] PR closes part of #85 (text: "addresses #85 — Phase 1/3"). Does NOT close issue.

### Phase 4.2 tasks
- [ ] Worktree: `.claude/worktree/issue-85-phase-2-resolver-attribution/`.
- [ ] Extend `Array<{ name; constraint }>` in `src/core/resolver.ts` and `graph.ts:135` to `Array<{ name; constraint; source }>` where `source` is a `ConstraintSource` discriminated union (`{ kind: "consumer-manifest" } | { kind: "transitive", manifestRef: string }`). Plumb through `resolveRepoVersions` → `resolveOneRepo` → `resolveIntersection`.
- [ ] Rewrite `resolveIntersection`'s error string: list each `<source-manifest>` → `<dep>` → `<constraint>` triple. Maintain test-friendliness (snapshot-able).
- [ ] Update `graph.ts:167-170` so the wrapping context names the conflicting repo + lists the constraint chain. Update `graph.ts:808` so transitive conflicts use the same `formatConstraintList` helper.
- [ ] Update `tests/core/error-attribution-snapshot.test.ts` snapshots (intended updates). Add red→green tests for the spec example from #85 ("greet-helper requires ^1.0.0" → attributed form).
- [ ] PR closes part of #85 (text: "addresses #85 — Phase 2/3"). Does NOT close issue.

### Phase 4.3 tasks
- [ ] Worktree: `.claude/worktree/issue-85-phase-3-collision-attribution/`.
- [ ] Extend `ResolvedEntity` to track the manifest path where the yamlKey was declared (consumer manifest = `./skilltree.yml`, transitive = `<repo>/skilltree.yml@<ref>`). Add field to `ResolutionState.entities` records.
- [ ] Rewrite `graph.ts:252` "Duplicate entity resolution" to name both source manifests.
- [ ] Rewrite `installer.ts:361` "not found at path" to also include `declared in <manifest>` where known.
- [ ] Update snapshots; add specific tests for collision attribution.
- [ ] PR uses `Closes #85` (closes issue on merge).

### Phase 4 deliverables (project-level)
- [ ] All three PRs ship to main green.
- [ ] `docs/planning/nitrogen/phase_4/{DETAILED_PLAN,TEST_PLAN,SHORT_MEMORY,RETRO}.md` updated as each sub-phase completes.
- [ ] PROJECTS.md moves Nitrogen back to Completed (date range updated).
- [ ] #85 closed; if all #78 children are closed, close #78 too.

## Nitrogen — Sub-project Status

Phase 1: ✅ COMPLETE
Phase 2: ✅ COMPLETE
Phase 3: ✅ COMPLETE
Phase 4: 🚧 IN PROGRESS (adopted 2026-05-18 to close #85)
  - 4.1: pending
  - 4.2: pending
  - 4.3: pending
