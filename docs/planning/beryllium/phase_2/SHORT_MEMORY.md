# Phase 2: Short Memory

## Stubs to Implement

### `src/commands/targets.ts` (new file)
- [ ] `targetsListCommand(dir, opts?)` — table output
- [ ] `targetsAddCommand(target, dir, opts?)` — add to manifest
- [ ] `targetsRemoveCommand(target, dir, opts?)` — remove from manifest
- [ ] `targetsDetectCommand(dir, opts?)` — scan + add missing
- [ ] `targetsMigrateCommand(dir, opts?)` — dev_install_path → install_targets
- [ ] `guardLegacyField(manifest)` — shared guard for add/remove/detect

### `src/cli.ts` (modify)
- [ ] Wire `targets` parent command with 5 subcommands
