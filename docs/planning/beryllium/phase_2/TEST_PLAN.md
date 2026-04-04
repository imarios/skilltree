# Phase 2: Test Plan — `skilltree targets` Subcommand

## Test File: `tests/commands/targets.test.ts`

### targetsListCommand
- [ ] shows known agents with detected/configured indicators
- [ ] shows custom paths from install_targets

### targetsAddCommand
- [ ] adds known agent to install_targets
- [ ] adds custom path to install_targets
- [ ] rejects duplicate target
- [ ] rejects unknown bare word
- [ ] errors when dev_install_path is set (directs to migrate)
- [ ] creates install_targets field if absent (defaults to [claude] + new target)

### targetsRemoveCommand
- [ ] removes target from install_targets
- [ ] errors when removing last target
- [ ] errors when target not found
- [ ] errors when dev_install_path is set

### targetsDetectCommand
- [ ] adds detected agents not already in install_targets
- [ ] skips agents already in install_targets
- [ ] errors when dev_install_path is set

### targetsMigrateCommand
- [ ] converts dev_install_path: .claude → install_targets: [claude]
- [ ] converts dev_install_path: .custom → install_targets: [./custom]
- [ ] converts legacy install_path → install_targets
- [ ] removes dev_install_path from manifest after migration
- [ ] warns when no dev_install_path to migrate
