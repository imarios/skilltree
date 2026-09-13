# Phase 2 — `freeze` / `unfreeze` + read surfaces

## Decisions (user, 2026-09-13)

- **Lockfile field: yes** — optional `frozen` on `LockfileEntry`.
- **`outdated --check`: ignores frozen rows.**

## Context for the lockfile decision

**Record `frozen` in the lockfile?** The posted design said "no lockfile schema change". Phase 1 showed a gap: removing `frozen:` by hand leaves the old version locked, because the lockfile can't tell a frozen 0.4.0 from a `*` that happened to resolve to 0.4.0, and 0.4.0 satisfies `*`. `list` also reads only the lockfile, so it can't show frozen state without it.

- **Recommended:** additive optional `frozen` on `LockfileEntry` (same pattern as `via_pack`, #153). Old lockfiles read fine; `classifyDep` marks an entry changed when `locked.frozen` and `dep.frozen` disagree; hand edits and `unfreeze` both just work; `list` can show it.
- Alternative: no field; `unfreeze` deletes the entry's lockfile rows to force re-resolution. Hand edits stay broken; `list` can't show frozen.

## Security pre-review

- `freeze <name> [tag]`: `tag` is validated with `parseFrozenVersion` before any git call, and only matched against `listTags` output before `writeRef`. No user string reaches a ref name unvalidated.
- Manifest writes go through the existing `writeManifest` / `writeGlobalManifest`.

## Design

### `skilltree freeze <name> [tag]`  (`src/commands/freeze.ts`)

Options: `-g, --global`, `-n, --dry-run`.

1. Load and validate the manifest (project or global). Find `<name>` as a yaml key in `dependencies` / `dev-dependencies`.
   - not found → error; `local:` → error ("local deps have no tags"); pack ref → error.
2. Pick the version:
   - `tag` given → must pass `parseFrozenVersion`, else error.
   - no `tag` → the lockfile entry's `version`; no entry or no version (tagless repo) → error "not installed yet — pass a tag".
3. Confirm upstream: `ensureCached` + `listTags`. Tag present → `writeRef(refs/skilltree/frozen/<version>, tagCommit)`, **overwriting** any preserved commit (this is how a user takes a moved tag). Tag absent but preserved ref present → keep it, warn. Neither → error.
4. Write `frozen: <as given, or locked version>`; drop `version:` (mutually exclusive) and say so when one was set: `removed version: "<0.5.0"`.
5. Run `installCommand` so the lockfile and install match. `--dry-run`: print the change, write nothing, skip install and `writeRef`.
6. Already frozen at the same version → no-op message, still refresh the preserved ref.

### `skilltree unfreeze <name>`  (`src/commands/unfreeze.ts`, or both in `freeze.ts`)

Options: `-g, --global`, `-n, --dry-run`.

1. Find the dep; not frozen → message, exit 0.
2. Remove `frozen:`. Leave no `version:` (defaults to `*`, following the repo's shared version).
3. Run `installCommand` (with the lockfile field, `classifyDep` sees the change; without it, delete the entry first).
4. Preserved ref is left in the cache (harmless; `cache clean` removes it).

### `update`

- `updateAll`: resolution already keeps frozen deps at their tag. After install, print one dim line per frozen dep: `stable: frozen at 0.4.0 (skilltree unfreeze stable to update)`.
- `selectiveUpdate(name)` on a frozen dep: print `"stable" is frozen at 0.4.0. Run \`skilltree unfreeze stable\` to update it.` and return without clearing the lockfile or installing.
- `reportBlockingConstraint`: skip frozen deps (the frozen note replaces it).

### `outdated`

- `OutdatedRow.frozenAt: string | null`.
- `readConstraintsByRepo` skips frozen deps (today they'd be read as `*`, both mis-reporting themselves as uncapped and never appearing as a capping sibling — correct, since they don't cap).
- Frozen rows still show `latest` and `bump`, annotated `frozen at X` in the table; `pinnedAt`/`cappedBy` null for them.
- `--check` ignores frozen rows (deliberate pin, not drift). Recommended; confirm with user alongside the lockfile question.

### `list`

- With the lockfile field: Version column renders `0.4.0 (frozen)`; `--json` rows get `frozen` when set.

### `add`

- `frozen` is a version-identity field → **not** in `PRESERVED_FIELDS` (CLAUDE.md pattern #3). Re-adding a frozen dep warns: `"stable" was frozen at 0.4.0; re-adding unfreezes it`.

### CLI, completion, help

- Register both commands in `src/cli.ts` next to `update` / `outdated`.
- `src/commands/completion.ts`: entries with `positionalComplete: "deps"` and the flags above.
- Help snapshot update; CLI/completion parity test must stay green.

## Tasks (TDD order)

- [ ] T0 user decision: lockfile `frozen` field; `outdated --check` ignores frozen
- [ ] T1 lockfile field (if chosen): write/read round-trip, `classifyDep` change detection, old lockfile compat
- [ ] T2 `freeze` tests (red) → command (green)
- [ ] T3 `unfreeze` tests (red) → command (green)
- [ ] T4 `update` all/selective frozen tests → update changes
- [ ] T5 `outdated` frozen tests → row + constraints + `--check`
- [ ] T6 `list` + `add` tests → changes
- [ ] T7 CLI registration, completion, help snapshot, parity
- [ ] T8 harden: tsc, biome, full suite; RETRO
