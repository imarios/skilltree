# Phase 2: `skilltree targets` Subcommand — Detailed Plan

## Overview

Build `src/commands/targets.ts` with list, add, remove, detect, and migrate subcommands. Wire into CLI. Follows the same pattern as `registry` command.

## Files to Create

### `src/commands/targets.ts`

1. **`targetsListCommand(dir, opts?)`** — table showing detected/configured agents + custom paths
2. **`targetsAddCommand(target, dir, opts?)`** — add target to install_targets, validate, reject duplicates
3. **`targetsRemoveCommand(target, dir, opts?)`** — remove target, error if last
4. **`targetsDetectCommand(dir, opts?)`** — scan for agents, add missing
5. **`targetsMigrateCommand(dir, opts?)`** — convert dev_install_path → install_targets

All commands:
- Guard: add/remove/detect error if `dev_install_path` is set (direct to migrate)
- Accept `opts.global` and `opts.globalDir` for global manifest support

## Files to Modify

### `src/cli.ts`
- Add `targets` parent command with `list`, `add`, `remove`, `detect`, `migrate` subcommands

## Security Pre-Review
- Commands only modify local YAML files — no network, no auth
- Low risk

## Phase-Specific DoD
- All 5 subcommands work for project manifests
- `--global` flag works for global manifests
- Guard prevents add/remove/detect when dev_install_path is set
- migrate converts dev_install_path → install_targets correctly (with reverse lookup)
- All existing tests still pass
