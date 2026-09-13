# Phase 2 — Short Memory

## Decisions (user, 2026-09-13)

- Lockfile entries get an optional `frozen` field (additive, like `via_pack`). Amends the #203 design comment's "no lockfile schema change" — call it out in the PR body.
- `outdated --check` ignores frozen rows.

## Stubs to implement

- [x] `src/types.ts`: `LockfileEntry.frozen?`
- [x] `src/core/lockfile.ts`: write `frozen` in `buildLockfile`, carry it in `entitiesFromLockfile`; `classifyDep` compares `locked.frozen` too
- [x] `src/commands/freeze.ts`: `freezeCommand`, `unfreezeCommand`
- [x] `src/commands/update.ts`: `reportFrozenDeps` after `updateAll`, early return in `selectiveUpdate` (`reportBlockingConstraint` already skips: frozen deps have no `version`)
- [x] `src/commands/outdated.ts`: `frozenAt` via `withFrozenAt`, skip frozen in `readConstraintsByRepo`, `--check`, "frozen at" note
- [ ] `src/commands/list.ts`: `(frozen)` in Version, `frozen` in JSON
- [ ] `src/commands/add.ts`: warn when re-add drops `frozen`
- [x] `src/cli.ts`, `src/commands/completion.ts`, help snapshot, flag-parity lists

## Tests written (red → green)

- [x] LF1–LF4
- [x] FR1–FR9, FR11 (FR10 global: still to write)
- [x] UF1–UF5
- [x] UP1–UP3
- [x] OD1–OD4
- [ ] LS1, AD1
- [x] CL1, CL2

## Found during the phase

- `freeze` first deleted the dep's lockfile entry to force re-resolution. That removed the previous commit `planInstall` needs to overwrite stale files (#119 Bug B), so FR1/UF1 reinstalled nothing. Now it clears only the entry's `frozen` marker (and only when freezing), which the diff sees as a change while the commit stays.
- Pre-commit hooks lint and type-check the whole tree, not just staged files: a red test importing a not-yet-written module blocks every commit.

## Notes

- `update` identifies deps by yaml key (`allDeps[name]`); `outdated` filters by installed name (`entry.name ?? key`). `freeze`/`unfreeze` follow `update`: yaml key.
- `freeze` must drop `version:` (mutually exclusive), so `unfreeze` can't restore a previous range — it returns the dep to `*`. Say so in the freeze output.
- `resolveFrozen` warns "To take the new commit: skilltree freeze <name> <tag>" — FR9 must make that advice true (overwrite the preserved ref).
- Completion lives in `src/commands/completion.ts` as a static table (`name`, `description`, `positionalComplete`, `flags[]`).
