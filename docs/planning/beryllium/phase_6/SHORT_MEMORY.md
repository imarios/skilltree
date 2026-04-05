# Phase 6: Short Memory

## All stubs implemented

### `src/commands/teach.ts` ✅
- [x] Replace manual copy loop with `addCommand()` + `installCommand()` calls
- [x] Set `install_targets` on global manifest based on detected agents
- [x] Keep `findSkillSource()` unchanged
- [x] Keep agent detection unchanged
- [x] Added `globalDir` to TeachOptions for testing

### `src/commands/install.ts` ✅
- [x] `installGlobal()` — uses `getInstallTargets(manifest, { global: true })` + `installToTargets()`
- [x] Removed hardcoded `getGlobalInstallBase()` for single-target

### `src/core/manifest.ts` ✅
- [x] `getInstallTargets()` — added `global` option to resolve via `resolveGlobalTarget()`
