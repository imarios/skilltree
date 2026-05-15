# Carbon Phase 5 — Short Memory

## New code

- [x] `src/commands/check.ts` — `checkCommand(dir, opts)` + exported `lintAsymmetricPublish(entities)`
- [x] `src/cli.ts` — registers `skilltree check` with `--strict`
- [x] `src/commands/completion.ts` — adds `check` to the completion table

## Tests

- [x] `tests/commands/check-publish.test.ts` — 10 unit tests on `lintAsymmetricPublish`
- [x] Existing `tests/cli/help-snapshot.test.ts` — regenerated snapshots after new command
- [x] `tests/commands/completion.test.ts` — passes after completion table updated
- [x] `tests/skills/skilltree-skill-freshness.test.ts` — passes after `skills/skilltree/references/commands.md` updated

## Doc updates

- [x] `README.md` — new "Publication Surface" subsection under Key Features
- [x] `docs/specs/spec.md` — added publication-surface flags to "Dependencies: Remote vs Local"
- [x] `skills/skilltree/references/commands.md` — new `skilltree check` section

## Notes

- The lint flags EVERY published entity that leaks (root + all intermediate published nodes). Initial test expected 1 warning for a 2-hop chain; updated to expect 2 because both `analysis` and `loader` would each fail downstream. More informative — fix the leaf to clear all of them.
- Strict mode integrates with the existing exit-1 pattern (`registry index --check`, `scan --check`). Tested by direct exit-code check in Phase 5's unit tests (lintAsymmetricPublish is pure — exit handling lives in `checkCommand` and is straightforward).
