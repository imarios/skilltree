# Phase 3: Short Memory

## Stubs to Implement

### `src/commands/install.ts`
- [ ] Replace single devInstallBase with getInstallTargets() loop in installCommand()
- [ ] --install-path overrides all targets
- [ ] installGlobal() uses resolveGlobalTarget() (deferred — global targets come in Phase 4)
- [ ] frozenInstall() supports multi-target

### `src/core/lockfile.ts`
- [ ] Add install_targets to Lockfile type and serialization

### `src/commands/vendor.ts`
- [ ] Single target check: error if multiple targets without --target
