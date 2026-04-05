# Phase 5: Polish — Detailed Plan

## Overview

Final polish pass: update README with multi-agent docs, update commands table, review error messages across all new code.

## Files to Modify

### `README.md`
- Add "Multi-Agent Support" section after Dev/Prod Separation
- Show `install_targets` YAML example
- Show `targets` subcommand usage
- Mention `targets migrate` for existing projects
- Update commands table with 6 new `targets` commands
- Update `teach` description from Claude Code–specific to multi-agent

### `docs/planning/beryllium/PLAN.md`
- Mark Phase 5 tasks complete

## Error Message Review

Reviewed all error paths added in Phases 1-4:
- `resolveTarget("foo")` → `unknown agent 'foo' — use ./foo for a custom path` ✓
- `validateManifest()` with both fields → `cannot use both dev_install_path and install_targets — migrate to install_targets` ✓
- `targetsAddCommand` duplicate → `<name> already in install_targets` ✓
- `targetsRemoveCommand` last → `cannot remove last target — at least one required` ✓
- `targetsRemoveCommand` missing → `<name> not in install_targets` ✓
- `guardLegacyField` → `cannot modify install_targets while dev_install_path is set. Run: skilltree targets migrate` ✓
- `targetsMigrateCommand` nothing → `nothing to migrate — dev_install_path not set` (warning) ✓
- `teachCommand` no agents → `no agents detected — use --agent <name> or install a coding agent first` ✓

All error messages include actionable guidance. No changes needed.

## Security Pre-Review
- README changes only — no code changes
- Zero risk

## Phase-Specific DoD
- README has multi-agent section with examples
- Commands table includes all targets subcommands
- All error messages reviewed and confirmed clear
