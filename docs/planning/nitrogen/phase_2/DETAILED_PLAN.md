# Phase 2 — Doctor orchestrator + text renderer + exit codes

Spec: docs/specs/doctor.md §D1, §D3–D6, §D11–D15, §D20–D22

## Goal

Land `skilltree doctor` end-to-end in text mode. Acceptance criteria 1–3 from issue #84 close here:
- A clean fresh project passes; exit 0.
- A project with a broken lockfile fails on `lockfile-sync`; exit 1.
- A project with malformed SKILL.md fails on `lint`; exit 1.

Phase 3 will add `--json`, `--global`, and registry-reachability. For Phase 2, those checks are represented as `status: "skip"` rows with `detail: "deferred to phase 3"` so the surface is complete but honestly labeled.

## Tasks

### Task 1 — Doctor orchestrator
File: `src/commands/doctor.ts` (NEW)

```ts
export interface DoctorOptions {
  json?: boolean;   // wired in Phase 3
  global?: boolean; // wired in Phase 3
}

export interface DoctorReport {
  checks: CheckResult[];
  summary: { pass: number; warn: number; fail: number; skip: number };
}

// Pure function: collects all checks, returns the report. No printing,
// no process.exit. Tests call this directly.
export async function runDoctor(dir: string, opts?: DoctorOptions): Promise<DoctorReport>;

// CLI wrapper: calls runDoctor, renders, sets exit code.
export async function doctorCommand(dir: string, opts?: DoctorOptions): Promise<void>;
```

The split mirrors `collectCheckIssues` ↔ `checkCommand`: the data-shaped function is testable, the CLI wrapper handles I/O.

### Task 2 — Per-check implementation

Each check is an `async () => CheckResult` that catches exceptions and renders them as `status: "fail"`. Order matches §D5–D10:

| Order | name | Implementation |
|---|---|---|
| 1 | `manifest-schema` | `validateManifest(manifest)` → if empty, pass; else fail with first error joined `; `. |
| 2 | `lint` | `collectCheckIssues(manifest, dir)` → if `lint.length + frontmatterWarnings.length === 0`, pass; else fail with count summary. |
| 3 | `lockfile-sync` | `readLockfile(dir)` → if null, fail "no lockfile". Else `diffManifestLockfile(manifest, lockfile)` → if added+removed+changed all empty, pass; else fail with count summary + fix "Run `skilltree install` to sync". |
| 4 | `target-consistency` | `resolveTargets(manifest.install_targets ?? [])` → if all `ok`, pass; else fail with first failing target. |
| 5 | `registry-reachability` | **Phase 2 stub**: return `status: "skip"`, `detail: "deferred to phase 3"`. |
| 6 | `frontmatter` | Already covered by check #2 (lint). For row-display clarity, surface a separate row that mirrors `frontmatterWarnings` from the same `collectCheckIssues` call (reuse the result; don't re-run). |

**Caching the lint result**: Run `collectCheckIssues` once and use its return value for both rows 2 and 6.

**Error isolation**: Each check function wraps its body in try/catch; an unexpected throw becomes `{name, status: "fail", detail: err.message}`. Other checks keep running.

### Task 3 — Text renderer

Reuse `printTable` (`src/core/ui.ts`). Two columns: `Check` (left, with status symbol) and `Detail` (right, dim for skip/empty, red for fail, yellow for warn).

```
$ skilltree doctor
manifest-schema           ✔
lint                      ✔
lockfile-sync             ✘ 2 entries in manifest not in lockfile: foo, bar
                            → Run `skilltree install` to sync
target-consistency        ✔
registry-reachability     – deferred to phase 3
frontmatter               ✔

✘ doctor: 1 failure
```

Implementation: probably easier than `printTable` for this case — a single hand-written loop emits one line per check + an optional indented `→ fix` line. That preserves the indented-fix formatting that `printTable` doesn't natively support.

### Task 4 — Exit codes

After rendering: `if (summary.fail > 0) process.exit(1)`. Otherwise return (exit 0). Matches §D20–D22.

### Task 5 — CLI wiring
File: `src/cli.ts`

```ts
import { doctorCommand } from "./commands/doctor.js";

program
  .command("doctor")
  .description("Preflight health check across schema, lint, lockfile, targets, registries, and frontmatter\n\nLifecycle: new → check → doctor → git tag")
  .action(async () => {
    await doctorCommand(process.cwd());
  });
```

`--json` and `--global` flags ship in Phase 3 (would require code paths that aren't built yet — adding the flag now would advertise a lie).

### Task 6 — Tests
File: `tests/commands/doctor.test.ts` (NEW)

Cases listed in TEST_PLAN.md.

### Task 7 — Help-snapshot regen + completion + commands.md

If a help snapshot test exists, regenerate. Update completion table for the new `doctor` subcommand. Update `docs/cli/commands.md` (or wherever the verb table lives) — survey first to find it.

## Security pre-review

| Concern | Phase 2 impact | Notes |
|---|---|---|
| Auth | None | Read-only command |
| Data flow | All reads (manifest, lockfile, agent registry, SKILL.md files) | Already covered by underlying functions |
| Secrets | None | No secrets touched |
| Infrastructure | None | Local-only; Phase 3 adds the one network call (ls-remote) |
| **Read-only invariant** | Must not write | Phase 3 has the snapshot test; for Phase 2 we verify by inspection — none of the called functions write |

## Phase-specific DoD additions

- `bun test` green (currently 1347; expect ~1357 after Phase 2 tests).
- `tsc --noEmit` clean.
- `bunx biome check src/ tests/` clean.
- Manual smoke: `bun run dev -- doctor` against this repo. Output is aligned, readable in an 80-col terminal, and the deferred row is honest.
- Help snapshot regenerated (if applicable).

## Risks

- **R1**: Text alignment without `printTable` could drift if status symbols have varying display widths (✔ vs ✘ are both 1-cell, but ⚠ in some terminals may render as 2-cell). Use a fixed-width prefix string (e.g., always 2 chars `<symbol><space>`).
- **R2**: `validateManifest` may not be called by `loadManifestOrThrow` for all manifests (it's a separate step). Verify: doctor must call `validateManifest` after `loadManifestOrThrow` so the result is fresh, not cached.
- **R3**: `process.exit(1)` short-circuits Bun's process — fine for the CLI but makes the function untestable. Mitigation: only call `process.exit` from `doctorCommand` (CLI wrapper); `runDoctor` returns the report.
