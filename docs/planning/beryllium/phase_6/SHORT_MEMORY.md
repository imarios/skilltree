# Phase 6: Short Memory

## Stubs to Implement

### `src/commands/teach.ts`
- [ ] Replace manual copy loop with `addCommand()` + `installCommand()` calls
- [ ] Set `install_targets` on global manifest based on detected agents
- [ ] Keep `findSkillSource()` unchanged
- [ ] Keep agent detection unchanged

### `src/commands/install.ts`
- [ ] `installGlobal()` — use `getInstallTargets(manifest, { global: true })` instead of `getGlobalInstallBase()`
- [ ] Loop over global targets like project install does

### `src/core/manifest.ts`
- [ ] `getInstallTargets()` — add `global` option to resolve via `resolveGlobalTarget()`
