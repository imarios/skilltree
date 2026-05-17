# Phase 2 — Short Memory

## Baseline (post-Phase 1)
- `bun test`: 1347 pass / 0 fail / 95 files
- Commit head: `a4467dd refactor(check): extract collectCheckIssues + resolveTargets (#84)`

## Stubs to implement

- [ ] `src/commands/doctor.ts` (NEW) — `runDoctor(dir, opts)` + `doctorCommand(dir, opts)`
  - [ ] `DoctorOptions` interface (json, global — both unused in Phase 2)
  - [ ] `DoctorReport` interface (`checks: CheckResult[]`, `summary: {pass,warn,fail,skip}`)
  - [ ] Per-check helpers: `checkManifestSchema`, `checkLint`, `checkLockfileSync`, `checkTargetConsistency`, `checkRegistryReachability` (stub returning skip), `checkFrontmatter`
  - [ ] Renderer `renderDoctor(report): void`
- [ ] `src/cli.ts` — register `doctor` subcommand (no flags yet)
- [ ] `src/commands/completion.ts` — add `doctor` entry (no flags yet)
- [ ] `README.md` — append `doctor` row to Commands table (Phase 2 cycle 080)
- [ ] `tests/commands/doctor.test.ts` (NEW) — 16 cases per TEST_PLAN
- [ ] Regen help snapshots after CLI wiring

## Notes / decisions

- **`runDoctor` is pure**: no `process.exit`. `doctorCommand` is the CLI wrapper that calls `runDoctor`, prints via `renderDoctor`, then maybe `process.exit(1)`.
- **Single lint invocation**: call `collectCheckIssues` once; share its result between the `lint` and `frontmatter` rows.
- **Phase 2 stub for `registry-reachability`**: `{name: "registry-reachability", status: "skip", detail: "deferred to phase 3"}`. Phase 3 replaces with real network check.
- **No `--json` flag in Phase 2**: shipping a flag whose code path doesn't exist would be a lie. Phase 3 lights it up.
- **No `--global` flag in Phase 2**: same.
- **`validateManifest` not `validateManifestOrThrow`**: doctor needs the error array, not an exception. (Phase 1 RETRO already flagged this.)

## Fixture decisions

- Use `tests/helpers/git-fixtures.ts`'s `createLocalSkill` for clean SKILL.md.
- For "malformed SKILL.md" hand-write the file (matches `tests/commands/check.test.ts` pattern).
- For lockfile fixtures, write a minimal `skilltree.lock` by hand — don't run a real install in tests (slow + flaky).

## Open

- Will `process.exit(1)` interaction with `bun:test` need the same `process.exit` mock pattern used in `check.test.ts:58-72`? Likely yes — bring that helper over (or extract to `tests/helpers/`).
