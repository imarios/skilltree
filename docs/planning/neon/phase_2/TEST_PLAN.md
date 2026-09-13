# Phase 2 — Test Plan

Fixture: the Phase 1 upstream (`stable` at v0.4.0 and v0.6.0, bare clone, `file://` repo), a project dir with `skilltree.yml`, `installCommand` for setup. Global variants use the `globalDir` test override.

## tests/core/lockfile-frozen.test.ts (if the lockfile field is chosen)

- **LF1** `buildLockfile` writes `frozen` for frozen entities only; direct unfrozen entries have no key.
- **LF2** round-trip: `frozen` survives serialize → parse.
- **LF3** a lockfile without `frozen` keys parses and installs as before.
- **LF4** `classifyDep`: locked frozen 0.4.0 + manifest without `frozen` → changed; locked unfrozen + manifest `frozen` → changed; both frozen at same version (`v0.4.0` vs `0.4.0` spellings) → unchanged.

## tests/commands/freeze.test.ts

- **FR1** `freeze stable 0.4.0` on an installed `*` dep → manifest has `frozen: 0.4.0`, no `version`; lockfile at 0.4.0; installed file is the v0.4.0 content.
- **FR2** `freeze stable` (no tag) → freezes at the lockfile version.
- **FR3** `freeze stable` on a dep not yet installed → error mentions passing a tag.
- **FR4** `freeze stable ^0.4.0` → error "exact"; manifest unchanged.
- **FR5** `freeze stable 0.5.0` (no such tag, nothing preserved) → error; manifest unchanged.
- **FR6** dep had `version: "<0.5.0"` → removed, and output says so.
- **FR7** `freeze` on a `local:` dep / pack ref / unknown name → distinct errors.
- **FR8** `--dry-run` → prints the change; manifest, lockfile, preserved ref untouched.
- **FR9** tag moved upstream after a first freeze → `freeze stable 0.4.0` again moves the preserved ref to the new commit; next resolve has no "moved" warning.
- **FR10** `--global` edits the global manifest.
- **FR11** `dev-dependencies` entry is found and frozen in place.

## tests/commands/unfreeze.test.ts

- **UF1** frozen 0.4.0 → `unfreeze stable` → manifest has no `frozen`; lockfile at 0.6.0.
- **UF2** `unfreeze` on a dep that isn't frozen → message, exit 0, nothing written.
- **UF3** unknown name → error.
- **UF4** `--dry-run` → nothing written.
- **UF5** (lockfile field) removing `frozen:` by hand then `install` → re-resolves to 0.6.0.

## tests/commands/update-frozen.test.ts

- **UP1** `update` with a frozen and an unfrozen dep in one repo → unfrozen moves to 0.6.0, frozen stays 0.4.0, output has the frozen note.
- **UP2** `update stable` on a frozen dep → message suggests `unfreeze`; lockfile bytes unchanged.
- **UP3** no "pinned at" constraint note for frozen deps.

## tests/commands/outdated-frozen.test.ts

- **OD1** frozen row: `frozenAt: "0.4.0"`, `latest: "0.6.0"`, `pinnedAt`/`cappedBy` null (JSON).
- **OD2** a `*` sibling of a frozen dep has no `cappedBy`.
- **OD3** `--check` with only frozen drift → exit code 0; with unfrozen drift → 1.
- **OD4** table output shows `frozen at 0.4.0`.

## tests/commands/list-frozen.test.ts / add

- **LS1** `list` Version column shows `0.4.0 (frozen)`; `--json` row has `frozen: "0.4.0"`.
- **AD1** `add stable --version *` over a frozen entry → `frozen` dropped, warning printed.

## CLI

- **CL1** help snapshots for `freeze`, `unfreeze`.
- **CL2** completion entries exist for both, flags match Commander (existing parity test).

## Verification

- `bun test` (timeboxed), `bunx tsc --noEmit`, `bunx biome check`.
- Manual: `bun run dev -- freeze <dep>` in a scratch project against a real tagged repo.
