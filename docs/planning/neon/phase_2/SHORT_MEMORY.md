# Phase 2 — Short Memory

## Decisions (user, 2026-09-13)

- Lockfile entries get an optional `frozen` field (additive, like `via_pack`). Amends the #203 design comment's "no lockfile schema change" — call it out in the PR body.
- `outdated --check` ignores frozen rows.

## Stubs to implement

- [ ] `src/types.ts`: `LockfileEntry.frozen?` (if chosen)
- [ ] `src/core/lockfile.ts`: write `frozen` in `buildLockfile`; `classifyDep` compares `locked.frozen` too
- [ ] `src/commands/freeze.ts`: `freezeCommand`, `unfreezeCommand`
- [ ] `src/commands/update.ts`: frozen note in `updateAll`, early return in `selectiveUpdate`, skip in `reportBlockingConstraint`
- [ ] `src/commands/outdated.ts`: `frozenAt`, skip frozen in `readConstraintsByRepo`, `--check`
- [ ] `src/commands/list.ts`: `(frozen)` in Version, `frozen` in JSON
- [ ] `src/commands/add.ts`: warn when re-add drops `frozen`
- [ ] `src/cli.ts`, `src/commands/completion.ts`, help snapshot

## Tests written (red → green)

- [ ] LF1–LF4
- [ ] FR1–FR11
- [ ] UF1–UF5
- [ ] UP1–UP3
- [ ] OD1–OD4
- [ ] LS1, AD1
- [ ] CL1, CL2

## Notes

- `update` identifies deps by yaml key (`allDeps[name]`); `outdated` filters by installed name (`entry.name ?? key`). `freeze`/`unfreeze` follow `update`: yaml key.
- `freeze` must drop `version:` (mutually exclusive), so `unfreeze` can't restore a previous range — it returns the dep to `*`. Say so in the freeze output.
- `resolveFrozen` warns "To take the new commit: skilltree freeze <name> <tag>" — FR9 must make that advice true (overwrite the preserved ref).
- Completion lives in `src/commands/completion.ts` as a static table (`name`, `description`, `positionalComplete`, `flags[]`).
