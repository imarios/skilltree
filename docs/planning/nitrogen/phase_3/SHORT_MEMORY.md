# Phase 3 — Short Memory

## Baseline (post-Phase 2)
- `bun test`: 1362 pass / 0 fail / 96 files
- Commit head: `889aa56 feat(doctor): preflight health check command (#84)`

## Stubs to implement

- [ ] `src/core/git.ts` — `lsRemote(url, {timeoutMs}): Promise<LsRemoteOutcome>` helper
  - [ ] `LsRemoteOutcome` type: `{ok: true} | {ok: false, reason, detail}`
  - [ ] Reason values: `"timeout" | "auth" | "unreachable" | "other"`
- [ ] `src/commands/doctor.ts`:
  - [ ] `ReachabilityProbe` type, default = real `lsRemote`
  - [ ] `runDoctor(dir, opts?)` — opts gains `globalDir?` and `probe?`
  - [ ] `--global` branching: load global manifest, skip lockfile + targets
  - [ ] Real `checkRegistryReachability(probe, configPath?)` (replaces stub)
  - [ ] `renderDoctorJson(report)`
  - [ ] `doctorCommand` branches on `opts.json`
- [ ] `src/cli.ts` — `--json` and `--global` flags on `doctor` subcommand
- [ ] `src/commands/completion.ts` — add `--json` and `--global` flags
- [ ] `skills/skilltree/references/commands.md` — document new flags
- [ ] `README.md` Key Flags table — add `doctor` to `--json` and `--global` rows
- [ ] Help snapshot regen

## New tests

- [ ] `tests/commands/doctor.test.ts` extended with: J1–J5 (json), G1–G4 (global), R1–R6 (reachability), C1–C4 (CLI), RO1–RO3 (read-only)

## Decisions made during planning

- **Probe injection via parameter** (not module-level setter): keeps `runDoctor` pure, no test isolation concerns. Type: `ReachabilityProbe = (url: string) => Promise<LsRemoteOutcome>`.
- **Auth-required = warn**, never fail (per spec). Detected via stderr pattern matching on common auth-failure strings.
- **Timeout = 5s** per spec D9. Implemented via `Promise.race` with `setTimeout`.
- **Q1 resolved**: `--global` still runs registry-reachability (registries are global config). Settled here, will update spec.
- **`--strict` flag NOT added in v1**: spec listed it as "already default"; keep implicit per spec Open Question Q2 disposition.

## Out of scope confirmations (matches spec)

- No `--fix` (future spec).
- No cross-project rollup.
- No new check kinds.
- Read-only invariant — Phase 3 has the test; the design has been read-only since Phase 2.
