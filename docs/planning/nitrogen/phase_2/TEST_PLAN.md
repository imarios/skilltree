# Phase 2 — Test Plan

## New file: `tests/commands/doctor.test.ts`

Pure function tests against `runDoctor(dir)` (no `process.exit`, no stdout capture needed for the data assertions). CLI-level tests against `doctorCommand(dir)` capture stdout and exit codes.

### `runDoctor` — data-shape cases

| # | Case | Setup | Expect |
|---|---|---|---|
| 1 | Clean project (acceptance #1) | `manifest`, valid SKILL.md, `lockfile` in sync, default `install_targets: [claude]` | all 6 checks pass except `registry-reachability` (skip in Phase 2 — stubbed) and `frontmatter` (pass); `summary.fail === 0` |
| 2 | Broken lockfile (acceptance #2) | Clean project, then `unlink skilltree.lock` | `lockfile-sync` has `status: "fail"`, detail mentions missing lockfile; `summary.fail >= 1` |
| 3 | Lockfile out of sync (added) | Clean project, edit manifest to add a local dep without re-installing | `lockfile-sync` has `status: "fail"`, detail mentions `added: 1`; fix string contains `skilltree install` |
| 4 | Malformed SKILL.md (acceptance #3) | Manifest with one local skill, SKILL.md missing `name:` | `lint` has `status: "fail"` (driven by frontmatter); `frontmatter` row also reflects it; `summary.fail >= 1` |
| 5 | Asymmetric publish leak | Two local skills, root → leaf where leaf has `publish: false`, both clean frontmatter | `lint` has `status: "fail"`; detail count >= 1 |
| 6 | Bad target | `install_targets: ["./does-not-exist"]` | `target-consistency` `fail` with detail referencing the path |
| 7 | Invalid manifest schema | `dependencies:` value is a string instead of map (or some validation error) | `manifest-schema` `fail` with the validator's error text |
| 8 | One check throws | Force an unexpected error inside one check (mock or fixture) | The throwing check is `fail` with `detail: err.message`; other checks still run |
| 9 | Order stability | Any project | `report.checks.map(c => c.name)` is exactly `["manifest-schema","lint","lockfile-sync","target-consistency","registry-reachability","frontmatter"]` |
| 10 | Registry-reachability is skipped in Phase 2 | Any project | row 5 has `status: "skip"`, `detail: "deferred to phase 3"` |

### `doctorCommand` — CLI behavior cases

| # | Case | Setup | Expect |
|---|---|---|---|
| 11 | Exit 0 on all-pass | Clean project | `doctorCommand` returns normally; `process.exit` not called with non-zero |
| 12 | Exit 1 on any fail | Broken lockfile project | `process.exit(1)` invoked |
| 13 | Text output shows symbols | Clean project | stdout contains `✔` rows |
| 14 | Text output shows fix line under fail | Broken lockfile project | stdout contains `→` indented line with the fix string |
| 15 | Footer summary line | Clean | stdout contains "all checks passed" or equivalent |
| 16 | Footer summary on fail | Broken lockfile | stdout contains "1 failure" or equivalent count |

CLI tests use the `captureOutput` + `process.exit` mock pattern from `tests/commands/check.test.ts:32-72`.

### Positive vs negative

- **Positive**: 1, 11, 13, 15
- **Negative**: 2, 3, 4, 5, 6, 7, 8, 12, 14, 16
- **Boundary / structural**: 9, 10

## Help-snapshot regen

Whatever `tests/cli/*help*.test.ts` exists — if it snapshots top-level help, regenerate. Otherwise verify manually that `bun run dev -- --help` lists `doctor`.

## Out of scope (Phase 3)

- `--json` flag and its snapshot test
- `--global` flag
- Real registry reachability with 5s timeout
- Read-only invariant test (mtime snapshot)
