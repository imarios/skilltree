# Phase 4: Test Plan — Teach Auto-Detection + Init

## Test File: `tests/commands/teach-agents.test.ts` (new)

### teach auto-detection
- [x] installs to single detected agent
- [x] installs to all detected agents by default
- [x] --agent restricts to specific agent
- [x] errors when no agents detected

## Test File: `tests/commands/init-agents.test.ts` (new)

### init auto-detection
- [x] auto-detects agents and populates install_targets
- [x] falls back to [claude] when no agents detected

## Test File: `tests/commands/teach.test.ts` (updated)

### existing tests updated for new API
- [x] installs skill files to target directory (via homeDir + .claude)
- [x] installs references alongside SKILL.md
- [x] prints completion hint in output
- [x] overwrites existing skill on re-run

## Test File: `tests/commands/init.test.ts` (updated)

### existing tests updated for install_targets
- [x] creates skilltree.yaml with install_targets (not dev_install_path)
- [x] creates .gitignore with skill and agent entries
- [x] appends to existing .gitignore without duplicating
- [x] refuses to overwrite existing skilltree.yaml
