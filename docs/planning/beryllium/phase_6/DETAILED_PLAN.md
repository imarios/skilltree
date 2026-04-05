# Phase 6: Teach as Global Dependency — Detailed Plan

## Problem

`teach` currently bypasses the entire skilltree pipeline — it finds the bundled skill source and copies it directly to agent directories. This means:
- The skilltree skill doesn't appear in the global lockfile
- `skilltree list --global` doesn't show it
- `skilltree verify --global` doesn't check it
- Updates aren't tracked

## Design

Rewrite `teach` as a thin wrapper around `addCommand` + `installCommand`:

```
teach → findSkillSource() → add --global skilltree --local <source> → install --global
```

### Path Stability Concern

The bundled skill source path changes between dev mode (`../../skills/skilltree/`) and compiled mode (`./skills/skilltree/`). This is fine because:
- `teach` is idempotent — each run overwrites the path in the global manifest
- Users run `teach` after every `npm update` or `make setup` anyway
- The global manifest stores an absolute path, so it works from any CWD

### Multi-Agent Global Install

`install --global` currently hardcodes `getGlobalInstallBase()` → `~/.claude`. With multi-agent:
- Global manifest gets `install_targets` (already supported in the type)
- `installGlobal` resolves targets via `resolveGlobalTarget()` (already exists)
- `teach` auto-detects agents and sets `install_targets` on the global manifest before installing

### Flow

1. `teach` detects agents
2. `teach` calls `addCommand("skilltree", { local: sourceDir, global: true })`
3. `teach` ensures global manifest has `install_targets` matching detected agents
4. `teach` calls `installCommand("", { global: true })`
5. The normal install pipeline handles resolution, installation, lockfile

## Files to Modify

### `src/commands/teach.ts`
- Replace manual copy with `addCommand` + `installCommand` calls
- Keep `findSkillSource()` (still needed to locate the bundled skill)
- Keep agent detection (to set `install_targets` on global manifest)

### `src/commands/install.ts`
- `installGlobal()`: use `getInstallTargets()` with `resolveGlobalTarget()` instead of hardcoded `getGlobalInstallBase()`

### `src/core/manifest.ts`
- `getInstallTargets()` needs a `global` mode that uses `resolveGlobalTarget()` instead of `resolveTarget()`

## Security Pre-Review
- No new attack surface — same operations, just going through the install pipeline
- Low risk

## Phase-Specific DoD
- `teach` uses `addCommand` + `installCommand` internally
- The skilltree skill appears in global lockfile after `teach`
- `skilltree list --global` shows the skilltree skill
- `install --global` respects `install_targets` on global manifest
- All existing tests pass
