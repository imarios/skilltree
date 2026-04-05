# Phase 6: Test Plan — Teach as Global Dependency

## Test File: `tests/commands/teach-agents.test.ts` (update existing)

### teach as global dep
- [ ] teach adds skilltree to global manifest as a local dependency
- [ ] teach creates global lockfile with skilltree entry
- [ ] teach is idempotent — second run doesn't error, updates path if changed
- [ ] teach --agent restricts install_targets on global manifest

## Test File: `tests/e2e/global-e2e.test.ts` (additions)

### global install with install_targets
- [ ] install --global with install_targets installs to multiple agent homes
- [ ] install --global resolves agent names to global home paths (~/.<agent>)

## Test File: `tests/core/manifest.test.ts` (additions)

### getInstallTargets global mode
- [ ] returns global home paths when global option is set
