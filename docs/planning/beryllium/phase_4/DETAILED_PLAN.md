# Phase 4: Teach as Global Dep + Init Detection — Detailed Plan

## Overview

Rewrite `teach` to auto-detect installed coding agents and install the skilltree skill to each. Rewrite `init` to use `install_targets` instead of `dev_install_path`, with agent auto-detection.

## Design Decision: Teach Implementation

The spec called for `teach` to use `add --global` + `install --global` internally. During implementation, this proved complex: the bundled skill source isn't in a git repo or local path that the global manifest can easily reference. The pragmatic approach is to keep the direct copy mechanism but make it agent-aware. The "teach as global dep" refactor is deferred to future work.

## Files to Modify

### `src/commands/teach.ts`
- Change signature from `teachCommand(target?: string)` to `teachCommand(opts?: TeachOptions)`
- `TeachOptions` includes `homeDir?` (testing) and `agent?` (restrict to one)
- Auto-detect agents via `detectInstalledAgents()`
- Loop: for each detected agent, find global home path, copy skill
- Error when no agents detected
- `--agent` flag restricts to a single agent

### `src/commands/init.ts`
- Add `homeDir?` to `InitOptions` for testing
- Call `detectInstalledAgents()` to populate `install_targets`
- Replace `dev_install_path: ".claude"` with `install_targets: [detected...]`
- Fall back to `["claude"]` when no agents detected
- Update `.gitignore` entries for all targets

### `src/cli.ts`
- Update teach wiring: remove `[target]` positional, add `--agent` option
- Init wiring: unchanged (homeDir is test-only, not a CLI flag)

### `src/commands/completion.ts`
- Add `--agent` flag to teach command definition

### `skills/skilltree/references/commands.md`
- Update teach section with new --agent flag and multi-agent behavior

## Breaking Change Assessment

- `teachCommand(target)` signature changes — existing tests must update
- `initCommand` now creates `install_targets` instead of `dev_install_path` — existing tests must update
- CLI `teach [target]` positional removed — users who used `skilltree teach ./dir` lose that workflow
  - Mitigation: this was rarely used (niche, undocumented for end users)

## Security Pre-Review
- `teach` reads agent directories and copies files — same as before, just to more directories
- No new auth or network surface
- Low risk

## Phase-Specific DoD
- `teach` auto-detects and installs to all agents
- `teach --agent <name>` restricts to one
- `teach` errors when no agents detected
- `init` uses `install_targets` instead of `dev_install_path`
- `init` auto-detects agents
- All existing teach and init tests updated and passing
- Completions and commands.md updated
