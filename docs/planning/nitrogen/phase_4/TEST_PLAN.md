# Phase 4 — Test Plan

## Phase 4.1 — Catalogue + harness

### `tests/core/error-attribution-snapshot.test.ts`

Fixture-driven: each test exercises one error site and snapshots the *current* text. Phase 4.2/4.3 update these intentionally.

| # | Site | Setup | Snapshot of |
|---|---|---|---|
| A1 | `resolveIntersection` no-match (single constraint) | tags = [`v0.9.2`], constraints = [{name:`greet-helper`,constraint:`^1.0.0`}] | `result.error` |
| A2 | `resolveIntersection` no-match (multi constraint) | tags = [`v1.0.0`,`v2.0.0`], constraints = [{foo,`^1.0.0`},{bar,`^2.0.0`}] | `result.error` |
| A3 | `resolveOneRepo` wraps A2 | mock repo with above tags, multi-entity manifest | `state.errors[0]` |
| A4 | Cross-repo transitive conflict | two repos, second declares first with conflicting constraint | `state.errors[0]` |
| A5 | Duplicate entity resolution | manifest with two yaml keys resolving to same composite | `state.errors[0]` |
| A6 | Install path not found | install plan with bad path | thrown Error message |

Goal: every classification = "mis-attributed" or "ambiguous" row from the audit has a snapshot.

### `docs/planning/nitrogen/phase_4/error-audit.md`

Static document; no runtime test. Verified by the snapshot test referencing it in the file header.

## Phase 4.2 — Resolver + graph attribution

Tests added or modified:

### `tests/core/resolver.test.ts` (extensions)

| # | Case | Setup | Expect |
|---|---|---|---|
| R1 | Single consumer constraint | constraints with `source: {kind:"consumer", manifestPath:"skilltree.yml"}` | error names `skilltree.yml requires <dep> <constraint>` |
| R2 | Multi consumer constraint | two consumer constraints | error lists both with manifest path prefix |
| R3 | Mixed consumer + transitive | one consumer + one transitive | each labeled with its source manifest |
| R4 | Transitive only | two transitive sources | each labeled `<repo>/skilltree.yml@<ref>` |
| R5 | Fix-line included | any conflict | error ends with `Fix: align constraints ...` |

### `tests/core/error-attribution-snapshot.test.ts` (updated)

- A1, A2, A3, A4 snapshots updated (intentional).

### `tests/core/graph-*.test.ts` (sweeps)

Audit existing assertions like `toContain("requires")`. Update each affected test with the new attribution wording. List the changed tests in the PR body.

### Acceptance test for #85's headline example

| # | Case | Setup | Expect |
|---|---|---|---|
| AC1 | Issue headline | consumer manifest declares `greet-helper@^1.0.0`, only `v0.9.2` exists | error string matches multiline form: `Version conflict on greet-helper:\n  skilltree.yml requires greet-helper ^1.0.0\n  resolved version: 0.9.2\n\nFix: ...` |

## Phase 4.3 — Collision attribution

### `tests/core/graph-collision-attribution.test.ts` (new)

| # | Case | Setup | Expect |
|---|---|---|---|
| C1 | Two consumer keys collide | manifest has two keys with same composite name | error names both as declared in `skilltree.yml` |
| C2 | Consumer + transitive collide | consumer key + transitive dep with same name | error names consumer manifest and `<repo>/skilltree.yml@<ref>` |
| C3 | Two transitives collide | two different upstream repos each declare the same entity | both transitive paths named in error |
| C4 | Install collision | installer.ts:361 error path | error includes `declared in <manifest>` when entity carries `declaredIn` |

### `tests/core/error-attribution-snapshot.test.ts` (updated)

- A5, A6 snapshots updated (intentional).

### Acceptance tests

| # | Case | Expect |
|---|---|---|
| AC2 | Read every snapshot file under `__snapshots__/error-attribution-snapshot*`. Every entry that was classified mis-attributed/ambiguous in 4.1's audit now starts with a manifest-path identifier. | All match |

## Cross-phase invariants

- Snapshots are deterministic: any tmp dir path or absolute file path is stripped/normalized via a helper before snapshotting.
- `bun test` green on every PR (no expected failures left).
- `tsc --noEmit` clean; `bunx biome check` clean.

## Out of scope

- Translating other resolver warnings (e.g. tagless-repo notice) — already adequately attributed.
- Frontmatter / manifest validation error rewording — already names files.
- Lockfile parse error rewording — already names the lockfile path.
- Localization / i18n.
