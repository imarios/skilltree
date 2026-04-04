# Phase 3: Multi-Target Install — Detailed Plan

## Overview

Change the install command to loop over `install_targets` instead of installing to a single path. Resolve deps once, install N times. Add `--install-path` override and vendor single-target restriction.

## Key Insight

`getInstallTargets(manifest)` already returns `[".claude"]` for existing projects without `install_targets`, so the loop is backward-compatible. The change is mechanical: replace `devInstallBase` single path with a loop.

## Files to Modify

### `src/commands/install.ts`
- **`installCommand()`**: Replace single `devInstallBase` with `getInstallTargets()` loop
  - `--install-path` overrides: use it as sole target
  - For each target: `planInstall()` + `executeInstall()`
  - Lockfile: record `install_targets` in lockfile metadata
- **`installGlobal()`**: Use `resolveGlobalTarget()` instead of hardcoded `getGlobalInstallBase()`
- **`frozenInstall()`**: Same multi-target loop

### `src/commands/vendor.ts`
- Check: if multiple targets, require `--target <name>` option
- If single target, proceed as before

### `src/core/lockfile.ts`
- Add `install_targets?: string[]` to `Lockfile` type
- Parse and serialize it

### `src/types.ts`
- Add `install_targets?: string[]` to `Lockfile` interface

## Security Pre-Review
- No new attack surface — same install operations, just to more directories
- Low risk

## Phase-Specific DoD
- `install_targets: [claude, codex]` installs to both directories
- `--install-path` overrides all targets for that invocation
- Vendor with multiple targets requires `--target`
- Lockfile records install_targets
- Stale target detection warns on install
- All existing tests pass (backward compat via getInstallTargets fallback)
