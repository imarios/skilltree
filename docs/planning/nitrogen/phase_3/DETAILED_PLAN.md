# Phase 3 — `--json` + `--global` + registry reachability

Spec: docs/specs/doctor.md §D2, §D9, §D16–D19, §D23–D24

## Goal

Round out doctor's surface:
1. **`--json`**: machine-readable output with a stable, snapshot-tested schema.
2. **`--global`**: run against `~/.skilltree/global.yaml`; skip project-scoped checks (lockfile, target-consistency) with `status: "skip"`.
3. **Real `registry-reachability`**: per-registry `git ls-remote` with a 5s timeout. Warns (does not fail) on unreachable / auth-required / timeout.
4. **Read-only invariant**: snapshot file mtimes before/after `runDoctor`; assert no changes.

## Tasks

### Task 1 — `--json` output
File: `src/commands/doctor.ts`

- Add `renderDoctorJson(report): void` next to `renderDoctor`. Emits the documented shape:
  ```json
  {
    "checks": [{ "name": "...", "status": "...", "detail": "?", "fix": "?" }, ...],
    "summary": { "pass": N, "warn": N, "fail": N, "skip": N }
  }
  ```
- `doctorCommand` branches on `opts.json` between renderers. Exit code identical (D22).
- Stable name list: `name` values are kebab-case identifiers, never spelled differently across modes.
- Detail/fix fields are present when set, omitted when absent (per D19). Use `JSON.stringify(report, null, 2)` — `undefined` values are naturally omitted.

### Task 2 — `--global` flag
File: `src/commands/doctor.ts`

- When `opts.global === true`:
  - Load via `readGlobalManifest(globalDir)` (already exists in `src/core/manifest.ts:473`).
  - `validateManifest` becomes `validateGlobalManifest` (D5 wrapping).
  - `lockfile-sync` row: `status: "skip"`, `detail: "global mode"`.
  - `target-consistency` row: `status: "skip"`, `detail: "global mode"`.
  - `lint`, `frontmatter`, `registry-reachability` still run (global manifest can still have local entries with frontmatter; registries are global config).
- Test override: `globalDir` parameter to `runDoctor(dir, opts)` for fixtures pointing at a temp dir's `global.yaml`. Mirror existing pattern in `listCommand`'s `globalDir` option.

### Task 3 — Registry reachability check
Files: `src/commands/doctor.ts`, possibly `src/core/git.ts`

- Replace the Phase 2 stub `checkRegistryReachabilityStub` with `checkRegistryReachability(opts)`.
- Implementation:
  1. Load registries via `listRegistries(configPath?)` (already exists).
  2. If list is empty: `status: "pass"`, `detail: "no registries configured"`.
  3. For each registry, call `lsRemote(repoUrl, { timeoutMs: 5000 })` — a new helper in `src/core/git.ts`.
  4. Aggregate: if every registry reachable, `status: "pass"`. If any unreachable/timeout/auth, `status: "warn"` (never `fail`, per spec). Detail summarizes the first warned registry.
- New helper `lsRemote(url, { timeoutMs }): Promise<LsRemoteOutcome>` where `LsRemoteOutcome = { ok: true } | { ok: false, reason: "timeout" | "auth" | "unreachable" | "other", detail: string }`.
  - Implementation: `simpleGit().listRemote([url])` raced against `setTimeout(timeoutMs)`. On timeout, the underlying child process is abandoned (we don't strictly need to kill it; reported as `timeout`). Auth detection: stderr contains `Authentication failed` / `could not read Username` / `Permission denied (publickey)` patterns.
  - Pure function except for the process spawn — testable by injecting a `lsRemoteImpl: (url) => Promise<LsRemoteOutcome>` parameter or by spawning against an unreachable URL (localhost port) in tests.

**Injection for testability**: introduce an internal `ReachabilityProbe = (url: string) => Promise<LsRemoteOutcome>` type. Default: the real `lsRemote`. Tests pass a mock probe via a parameter on `runDoctor` (or via a module-level setter — pick the cleaner one). Going with a parameter:
```ts
runDoctor(dir, opts?: DoctorOptions & { probe?: ReachabilityProbe })
```

### Task 4 — Read-only invariant test
File: `tests/commands/doctor.test.ts` (extend)

- Snapshot every regular file's mtime under the project dir before invocation.
- Run `runDoctor` (text mode and JSON mode separately).
- Assert each file's mtime is identical post-invocation.
- Don't include the `.skilltree/` cache dir from `ensureCached` — but `doctor` MUST NOT call `ensureCached`. `lsRemote` reads from the network without ever updating local cache. Verify by inspection.

### Task 5 — CLI wiring
File: `src/cli.ts`

```ts
program
  .command("doctor")
  .description("...")
  .option("--json", "Output results as JSON")
  .option("-g, --global", "Run against the global manifest")
  .action(async (opts) => {
    await doctorCommand(process.cwd(), { json: opts.json, global: opts.global });
  });
```

Plus `src/commands/completion.ts` — add flags to the `doctor` entry.

### Task 6 — Help-snapshot regen
Run `bun test tests/cli/help-snapshot.test.ts --update-snapshots` after wiring.

### Task 7 — Docs
- `skills/skilltree/references/commands.md`: add `--json` and `--global` to the `doctor` section.
- `README.md`: extend "Key Flags" table — `--json` (add `doctor` to the existing row) and `--global` (add `doctor` to existing row).

## Security pre-review

| Concern | Phase 3 impact |
|---|---|
| **Network call** | First network call from doctor: `git ls-remote <registry-url>`. Read-only (no fetch, no clone). 5s timeout bounds blast radius. |
| Auth tokens | Inherits the user's git credential helper, same as `skilltree install`. No new credential surface. |
| Command injection | `simpleGit().listRemote(...)` passes args as argv (not shell). Safe. |
| **Read-only invariant** | Phase 3 explicitly tests this. `ls-remote` never updates the local cache. |
| Resource exhaustion | Worst case: N registries × 5s timeout = N×5s wall clock if all hang. Acceptable for a manual command; not run in tight loops. |

## Phase-specific DoD additions

- `bun test` green. tsc + biome clean.
- Manual smoke against this repo:
  - `bun run dev -- doctor` shows registry-reachability row with real status.
  - `bun run dev -- doctor --json | jq .` parses correctly.
  - `bun run dev -- doctor --global` runs without crashing (or fails gracefully on no global manifest).
- Help snapshot updated.
- Mtime invariant test passes.

## Risks

- **R1**: `simpleGit().listRemote` may not honor an AbortController — verify. If not, use child_process.spawn with a kill timeout, or accept that the spawn outlives the test (acceptable for production; tests can pass `unreachable: localhost:9` which fails fast).
- **R2**: `--global` interaction with reachability — D9 says still run (registries are global config). Confirmed in the open-question Q1 from spec; we settle it here as "always run."
- **R3**: Mtime test may be flaky on filesystems with low resolution (HFS+ is 1s). Use `nanoseconds` from `stat` (`mtimeMs`) and assert exact equality.
