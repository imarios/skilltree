# Phase 3 — Test Plan

## Extensions to `tests/commands/doctor.test.ts`

### `runDoctor` with `--json`-shaped output

| # | Case | Setup | Expect |
|---|---|---|---|
| J1 | JSON shape (snapshot) | Clean project | `JSON.stringify(report, null, 2)` matches snapshot |
| J2 | Detail and fix only present when set | Clean (no failures) | JSON does not contain "detail":, "fix": (since they're omitted) |
| J3 | Fail row includes detail and fix | Broken-lockfile project | JSON includes "detail" and "fix" for `lockfile-sync` |
| J4 | `name` identifiers stable | Any project | `report.checks.map(c => c.name)` matches the documented list verbatim |
| J5 | Summary matches checks tally | Any project | `summary.pass + warn + fail + skip === checks.length` |

### `runDoctor` with `--global`

| # | Case | Setup | Expect |
|---|---|---|---|
| G1 | Global mode skips project-scoped checks | Temp `~/.skilltree/global.yaml`; `runDoctor("", {global: true, globalDir})` | `lockfile-sync` and `target-consistency` rows are `status: "skip"`, detail "global mode" |
| G2 | Global mode runs lint/frontmatter | Global manifest with one local entry | `lint`/`frontmatter` rows still present and meaningful |
| G3 | Global mode runs reachability | Same setup | `registry-reachability` row still runs (per spec) |
| G4 | Missing global manifest | No global file at `globalDir` | `manifest-schema` row is `fail` with detail mentioning global manifest |

### Registry reachability

Use an injected mock probe (`ReachabilityProbe`) to avoid real network calls in tests.

| # | Case | Probe behavior | Expect |
|---|---|---|---|
| R1 | All registries reachable | Always returns `{ok: true}` | `registry-reachability` `pass` |
| R2 | One registry unreachable | First fails with `reason: "unreachable"` | `warn`, detail mentions the registry name + reason |
| R3 | Auth-required is `warn` not `fail` | Returns `{ok: false, reason: "auth"}` | `warn` (not `fail`) |
| R4 | Timeout is `warn` not `fail` | Returns `{ok: false, reason: "timeout"}` | `warn`, detail mentions timeout |
| R5 | Empty registry list | `listRegistries` returns `[]` | `pass`, detail "no registries configured" |
| R6 | Probe throws | Probe rejects | check row is `fail` (per-check error isolation, Phase 2 invariant) |

### CLI behavior (json + global + exit codes)

| # | Case | Setup | Expect |
|---|---|---|---|
| C1 | `--json` exit 0 on pass | Clean | stdout is valid JSON; `process.exit` not called with non-zero |
| C2 | `--json` exit 1 on fail | Broken lockfile | stdout is valid JSON; `process.exit(1)` |
| C3 | `--json` parsable | Any | `JSON.parse(stdout)` does not throw |
| C4 | `--json` no color codes | Any | stdout matches `/^[\s\x20-\x7E]*$/` (no ANSI escapes) |

### Read-only invariant

| # | Case | Setup | Expect |
|---|---|---|---|
| RO1 | Text mode does not write | Clean project | mtimes of every file under dir unchanged before/after `runDoctor` |
| RO2 | JSON mode does not write | Clean project | same |
| RO3 | Global mode does not write | Temp globalDir | mtimes under globalDir unchanged before/after |

## Out of scope

- Real network reachability (covered by manual smoke test, not unit).
- The `--global` flag's interaction with vendor mode (vendor doesn't apply to global).
