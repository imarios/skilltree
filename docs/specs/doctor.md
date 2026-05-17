# Doctor — Preflight Health Check

+++
version = "1.0"
date = "2026-05-17"
status = "active"

[[changelog]]
version = "1.0"
date = "2026-05-17"
summary = "Initial spec — `skilltree doctor` command bundling six existing health checks (manifest schema, lint, lockfile sync, target consistency, registry reachability, frontmatter) with text + --json output and a --global flag. Resolves issue #84."
+++

## Problem Statement

Today each health check lives behind its own command (`check`, `install --frozen` for lockfile drift, `targets list` for target resolution, ad-hoc curiosity for registry reachability). An author preparing a release has to run several commands and remember to inspect each one. A consumer cloning a repo has no single "is this project healthy?" verb. `skilltree doctor` is the one-stop preflight, modeled after `brew doctor` / `rustup doctor` / `npm doctor`.

This is part of **Authoring UX v1** (#78). The Read-only inspection layer milestone (#77) references but does not own this verb.

## Goals & Non-Goals

### Goals

- One command an author runs before `git tag vX.Y.Z`: "am I ready to publish?"
- One command a consumer runs after `git clone`: "is this project healthy?"
- Read-only — `doctor` MUST NOT write to disk, mutate the manifest, modify the lockfile, or touch the cache.
- Reuse every existing check as a callable function — no duplicated validation logic.
- Stable JSON shape suitable for CI consumption and future tooling integration.

### Non-Goals

- **Auto-fix.** No `--fix` flag. That's a separate value prop with its own design space (which fixes are safe to apply automatically, prompting, dry-run, etc.).
- **Cross-project aggregation.** No "doctor all my projects" rollup. Combine with a future `skilltree projects` verb if anyone wants it.
- **New check kinds.** Doctor wires up *existing* checks. New health checks (e.g., dependency-graph cycle detection, schema-version drift) are out of scope for v1.
- **Network-by-default beyond reachability.** No upstream version probes, no SKILL.md content fetches. Registry reachability is the only network call, and it uses a 5s timeout.

## Requirements

Numbered for spec-to-phase traceability.

### Surface

- **D1**: The command is invoked as `skilltree doctor`.
- **D2**: Flags supported:
  - `--json` — emit machine-readable JSON instead of human text. Exit codes unchanged.
  - `--global` — run against the global manifest (`~/.skilltree/global.yaml`) instead of the project manifest. When set, project-scoped checks (lockfile, targets) are skipped with `status: "skip"`.
  - No `--strict` flag is exposed in v1; strict-on-failure is the only mode. (Listed in the issue as already-default; we keep it implicit to leave room for a future `--lenient` if it ever makes sense.)
- **D3**: Help text (`skilltree doctor --help`) lists the six checks performed.
- **D4**: Help text mentions the lifecycle position: `new → check → doctor → git tag`.

### Checks performed (in this order)

- **D5 — Manifest schema**: Call `validateManifestOrThrow` (`src/core/manifest.ts`). Pass: manifest parses and conforms. Fail: surface the validation error's message.
- **D6 — Lint**: Call the `check` command's core logic as a function (Phase 5 of Carbon exposed `checkCommand` — Nitrogen Phase 1 will expose its inner logic as `runCheck(opts)` returning a result). Pass: no design-time issues, including frontmatter lint and asymmetric-publish lint. Fail: summarize the count + first detail.
- **D7 — Lockfile sync**: Call `diffManifestLockfile` (`src/core/lockfile.ts`). Pass: no `added` or `removed` entries. Fail: list counts and first entry of each. Suggested fix string: `Run \`skilltree install\` to sync`.
- **D8 — Target consistency**: Call the resolution helper underlying `targets list` (currently inside `src/commands/targets.ts`). Pass: every entry in `install_targets` resolves through the agent registry, OR is a literal path that exists. Fail: list the first unresolved target. Suggested fix: `Check install_targets in skilltree.yml`.
- **D9 — Registry reachability**: For each registry in `~/.skilltree/config.yaml`, run `git ls-remote <url>` with a 5s timeout. Pass: all reachable. **Warn** (do not fail) when a registry requires auth and is skipped. Fail: surface the unreachable URL and the underlying error. When `--global` is set, this check still runs (registries are global config).
- **D10 — Frontmatter validity**: Covered by D6 (the lint check already includes frontmatter validation). The doctor output lists it as a separate row for readability; internally it is the same check.

### Output — text mode (default)

- **D11**: Aligned two-column table. Left column = check name, right column = status symbol + detail/fix.
- **D12**: Status symbols: `✔` pass, `✘` fail, `⚠` warn, `–` skip (used for project checks under `--global`).
- **D13**: Failed checks render a second indented line starting with `→` containing the suggested fix string (when one exists).
- **D14**: Footer: `✘ doctor: N failure(s), M warning(s)` (red) on fail, `✔ doctor: all checks passed` (green, possibly with a warning suffix) on pass.
- **D15**: Colors honor existing `NO_COLOR` / TTY-detection patterns already used elsewhere in the CLI.

### Output — JSON mode (`--json`)

- **D16**: Stable, documented JSON shape (snapshot-tested):
  ```json
  {
    "checks": [
      { "name": "manifest-schema",       "status": "pass" },
      { "name": "lint",                  "status": "pass" },
      { "name": "lockfile-sync",         "status": "fail", "detail": "2 entries in manifest not in lockfile: foo, bar", "fix": "Run `skilltree install` to sync" },
      { "name": "target-consistency",    "status": "pass" },
      { "name": "registry-reachability", "status": "warn", "detail": "voltagent — auth required (skipped)" },
      { "name": "frontmatter",           "status": "pass" }
    ],
    "summary": { "pass": 4, "warn": 1, "fail": 1, "skip": 0 }
  }
  ```
- **D17**: `name` values are stable identifiers (kebab-case, never re-spelled). Adding a new check is additive; renaming or removing an existing one is a breaking change.
- **D18**: `status` is one of `"pass" | "fail" | "warn" | "skip"`.
- **D19**: `detail` and `fix` are optional strings, omitted when absent.

### Exit codes

- **D20**: `0` when there are zero `fail` entries. Warnings do not affect exit code.
- **D21**: `1` when there is at least one `fail` entry.
- **D22**: Exit codes are identical between text and JSON modes.

### Read-only invariant

- **D23**: `doctor` MUST NOT write to disk. No manifest writes, no lockfile writes, no cache writes, no `.skilltree/` writes, no logs. Verified by a test that snapshots file mtimes before/after invocation.
- **D24**: `doctor` MUST NOT use the install path or any code that performs git clones beyond `git ls-remote`. The only network call is the per-registry `ls-remote` in D9.

## Constraints

- Reuse existing implementations. Doctor is an orchestrator, not a re-implementation.
- The 5s ls-remote timeout uses the same wrapper pattern as elsewhere in the codebase (look for existing timeout helpers in `src/core/git.ts` before rolling a new one).
- Output rendering should reuse the `printTable` helper extracted in commit b03fe31 (the shared table helper for list/outdated) where reasonable.

## Error Handling

| Scenario | Behavior | User Impact |
|----------|----------|-------------|
| No manifest at cwd | Fail D5 with a clear message | User sees `manifest-schema ✘ no skilltree.yml found at cwd → Run \`skilltree init\`` |
| `--global` and no global manifest | Fail D5 with a clear message | User sees `manifest-schema ✘ no global manifest at ~/.skilltree/global.yaml` |
| Registry URL unreachable (network down) | Warn, do not fail | User sees `registry-reachability ⚠ <url> unreachable: <err>` and overall exit 0 |
| Registry URL requires auth | Warn, skipped | User sees `registry-reachability ⚠ <name> — auth required (skipped)` |
| `git ls-remote` times out (>5s) | Warn, do not fail | User sees `registry-reachability ⚠ <url> — timeout after 5s` |
| Lockfile missing | Fail D7 | User sees the diff treat-as-empty result and the install fix string |
| `install_targets` empty | Pass D8 (vacuously) | No entries to resolve = nothing to fail |

A check that throws an unexpected error should be caught and rendered as `fail` with `detail: "<error message>"` rather than crashing the whole command.

## Testing Checklist

Lifted from the issue's acceptance criteria plus the read-only invariant:

- [ ] A clean fresh project (`init` + `install`) passes all checks; exit 0.
- [ ] A project with a deliberately broken lockfile (`rm skilltree.lock`) fails on `lockfile-sync`; exit 1.
- [ ] A project with a malformed SKILL.md (per the `check` frontmatter lint) fails on `lint`; exit 1.
- [ ] `--json` output matches the documented schema (snapshot test).
- [ ] `--json` and text modes produce identical exit codes for the same project state.
- [ ] No file mtime changes after invocation (read-only invariant, D23).
- [ ] `--global` skips project-scoped checks with `status: "skip"`.
- [ ] Unreachable registry produces a `warn`, not a `fail`; exit 0.
- [ ] Auth-required registry produces a `warn`; exit 0.
- [ ] An unexpected exception inside one check renders as `fail` for that row; other checks still run.

## Open Questions

- **Q1**: Should `--global` skip registry-reachability the same way it skips lockfile/targets, or always run it? Currently spec says always run (registries are global config). Confirm during cycle 020.
- **Q2**: Should the text-mode footer count `skip` entries separately, or fold them in? Currently spec shows only fail+warn in the footer. Probably fine for v1.
- **Q3**: Do we want a `--check <name>` filter (run only one named check)? Listed as future work, not v1.

## Future Work

- `--fix` flag for auto-remediation (separate spec).
- `skilltree projects doctor` cross-project rollup.
- `--check <name>` filter to run a single named check.
- New check kinds: dependency-graph cycle detection, schema-version drift, vendor-dir staleness.
