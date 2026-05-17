# Phase 1 — Foundation: extract checks as callable functions

Spec: docs/specs/doctor.md (D5–D10, D16–D19)

## Current state (from src/ survey)

| Concern (Spec ID) | Function exists today? | Pure? (returns data, no print/throw) | Action |
|---|---|---|---|
| Manifest schema (D5) | `validateManifest(manifest): string[]` in `src/core/manifest.ts:351` | ✅ pure | None — doctor calls directly. `validateManifestOrThrow` is the throwing variant; doctor avoids it. |
| Lockfile sync (D7) | `diffManifestLockfile(manifest, lockfile): LockfileDiff` in `src/core/lockfile.ts:241` | ✅ pure | None. `readLockfile(dir): Promise<Lockfile \| null>` is the loader. |
| Lint asymmetric publish (D6) | `lintAsymmetricPublish(entities): string[]` in `src/commands/check.ts:71` | ✅ pure | None. |
| Lint frontmatter (D6, D10) | `lintLocalFrontmatter(manifest, dir): {warnings, notes}` in `src/commands/check.ts:137` | ✅ pure | None. |
| `check` orchestration (D6) | `checkCommand(dir, opts)` in `src/commands/check.ts:27` | ❌ prints + side-effecting `process.exit` | **Extract** `runCheck(manifest, dir): Promise<CheckSummary>` so doctor reuses it without re-implementing. CLI wrapper becomes thin renderer. |
| Target consistency (D8) | `resolveTarget(target): string` in `src/core/agents.ts:55` — **throws** on unknown bare word | ❌ throws | **Add** `resolveTargets(targets): TargetResolution[]` that catches per-entry and returns `{target, ok, path?, error?}`. |

## Phase 1 task breakdown

### Task 1 — Add `CheckResult` types (small)
File: `src/types.ts`
- Add `CheckStatus = "pass" | "fail" | "warn" | "skip"`
- Add `CheckResult = { name: string; status: CheckStatus; detail?: string; fix?: string }`
- Add `CheckSummary = { lint: string[]; frontmatterWarnings: string[]; frontmatterNotes: string[] }`

These live in `src/types.ts` (not a new `doctor-types.ts`) because they're shared CLI surface, not doctor-internal.

### Task 2 — Extract `runCheck` from `check.ts`
File: `src/commands/check.ts`
- Add `export async function runCheck(manifest: Manifest, dir: string): Promise<CheckSummary>` that:
  - Calls `resolveAll(manifest, dir)` (already imported)
  - Calls `lintAsymmetricPublish(result.entities)` → `lint: string[]`
  - Calls `lintLocalFrontmatter(manifest, dir)` → `{warnings, notes}`
  - Returns `{ lint, frontmatterWarnings: warnings, frontmatterNotes: notes }`
- Refactor `checkCommand` to call `runCheck` then print + exit. **No user-visible change.**

### Task 3 — Add `resolveTargets` to targets module
File: `src/commands/targets.ts` (or new `src/core/targets.ts` if it grows)
- Add `export interface TargetResolution { target: string; ok: boolean; path?: string; error?: string }`
- Add `export function resolveTargets(targets: string[]): TargetResolution[]` that, per entry:
  - Try `resolveTarget(target)` — if it returns a path, `{ok: true, path}`
  - If it throws (unknown agent bare word), `{ok: false, error: err.message}`
  - For literal paths starting with `./`, `/`, `~/` — also `fs.stat` the path; if missing, `{ok: false, error: "path does not exist: <path>"}`
- This is the function doctor's D8 check will call. Keep `targetsListCommand` calling its existing `buildTargetsListRows` helper — that one's UI-shaped.

### Task 4 — Tests
File: `tests/core/run-check.test.ts` (new) — 4 cases:
- Clean manifest with no entities → empty summary
- Manifest with publish:false leak → lint has one entry, frontmatter empty
- Manifest with malformed SKILL.md frontmatter → frontmatterWarnings non-empty
- `runCheck` and `checkCommand` produce identical lint output (regression guard via capturing console)

File: `tests/core/resolve-targets.test.ts` (new) — 5 cases:
- Known agent → ok: true, path is the agent dir
- Unknown bare word → ok: false, error mentions the word
- Existing literal path (`./` to an existing dir) → ok: true
- Missing literal path → ok: false, error mentions "does not exist"
- Mixed list → returns one entry per input, in order

Existing tests under `tests/commands/check*.test.ts` continue to pass unchanged (regression guard).

## Security pre-review

| Concern | Phase 1 impact | Notes |
|---|---|---|
| Auth / authz boundaries | None | No new endpoints, no permissions changes. |
| Data flow / trust boundaries | None | Refactor only — same data, same callers. |
| Secrets / credentials | None | No secrets handling introduced. |
| Infrastructure exposure | None | No deployment/network changes. |
| Filesystem reads | `resolveTargets` adds `fs.stat` calls for literal paths | Read-only, no writes. Bounded to paths the manifest already enumerates. |

No P0 risks. Phase 1 is a pure refactor + one new read-only helper.

## Phase-specific DoD additions

- **Regression guard**: `bun test tests/commands/check*` must produce byte-identical PASS counts before and after. Capture pre-count in SHORT_MEMORY before Task 2.
- **No CLI behavior change**: `skilltree check --help` snapshot unchanged. (If a snapshot test exists, it should not regenerate; if it does, that's a bug.)
- **Type-check clean**: `tsc --noEmit` clean (no `any` introduced).
- **Biome clean**: lint + format.

## Risks & mitigations

- **R1**: `runCheck`'s contract for `frontmatterNotes` — the current code prints notes with `dim(...)` (no warn counter). Doctor will discard notes for D6 (only warnings count). Mitigation: `runCheck` returns notes separately so doctor doesn't accidentally promote them.
- **R2**: `resolveTargets` accidentally throwing — wrap each `resolveTarget(...)` call in try/catch individually so one bad entry doesn't kill the whole list.
- **R3**: Per-entry `fs.stat` is O(n) syscalls. Fine for the N ≤ 10 targets a manifest typically has; if a project ever has hundreds, revisit. Out of scope for v1.
