# Phase 1 — Test Plan

## New test files

### `tests/commands/run-check.test.ts` (new)

Tests for the extracted `collectCheckIssues(manifest, dir)` function.

| # | Case | Setup | Expect |
|---|---|---|---|
| 1 | Clean project, no entities | manifest with empty `dependencies` | `{lint: [], frontmatterWarnings: [], frontmatterNotes: []}` |
| 2 | Asymmetric publish leak | manifest with two local skills, root → leaf where leaf has `publish: false`, both SKILL.md files valid | `lint.length === 1` containing leaf name; frontmatter empty |
| 3 | Malformed SKILL.md | manifest with one local skill, SKILL.md missing required `name` field | `frontmatterWarnings.length > 0` mentioning `name`; lint empty |
| 4 | Regression — output parity with `checkCommand` | Same fixture as #2; capture `checkCommand`'s stderr+stdout; call `collectCheckIssues`; assert the warnings shown by `checkCommand` are exactly those returned by `collectCheckIssues.lint` | Counts match; first warning string contains the leaf name in both |

### `tests/core/resolve-targets.test.ts` (new)

Tests for the new `resolveTargets(targets)` function.

| # | Case | Input | Expect |
|---|---|---|---|
| 1 | Known agent | `["claude"]` | `[{target: "claude", ok: true, path: ".claude"}]` |
| 2 | Unknown bare word | `["badagent"]` | `[{target: "badagent", ok: false, error: /unknown/i}]` |
| 3 | Existing literal path | `["./foo"]` with `./foo` mkdir'd in tmpdir + cwd = tmpdir | `[{target: "./foo", ok: true, path: "./foo"}]` |
| 4 | Missing literal path | `["./does-not-exist"]` | `[{target: "./does-not-exist", ok: false, error: /does not exist/i}]` |
| 5 | Mixed list order preserved | `["claude", "badagent", "./missing"]` | length === 3; entries appear in input order; status flags match each kind |
| 6 | Empty list | `[]` | `[]` |

### `tests/commands/check.test.ts` (existing — regression)

Run `bun test tests/commands/check*` before and after Task 2. The pre-count and post-count must match exactly. Add this to SHORT_MEMORY.

## Positive vs negative cases

- **Positive**: cases 1, 2, 4 (resolveTargets); case 1 (collectCheckIssues — no issues found)
- **Negative**: cases 2, 3 (collectCheckIssues — issues found); cases 2, 4 (resolveTargets — bad inputs)
- **Boundary**: case 6 (empty list); case 5 (mixed; verifies order preservation, which matters for D11 row ordering)

## Async / integration markers

All tests are pure async (`async () => {...}`) — no `bun test --integration` markers needed. No network, no external services.

## Out of scope for Phase 1

- Doctor-orchestrator tests → Phase 2
- `--json` schema snapshot → Phase 3
- Read-only invariant (mtime) → Phase 3
- Registry reachability → Phase 3
