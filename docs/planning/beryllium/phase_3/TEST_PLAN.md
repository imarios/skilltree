# Phase 3: Test Plan — Multi-Target Install

## Test File: `tests/e2e/multi-target-e2e.test.ts`

### Multi-target install
- [ ] install_targets: [claude, codex] installs skills to both .claude/ and .codex/
- [ ] install_targets: [claude] installs to .claude/ only (single target, backward compat)
- [ ] Mixed agent + custom path: [claude, ./custom] installs to both
- [ ] --install-path overrides install_targets for that invocation

### Lockfile
- [ ] Lockfile records install_targets after install

### Vendor
- [ ] vendor with single target works without --target
- [ ] vendor with multiple targets requires --target flag

### Stale target
- [ ] Install warns when lockfile has targets not in current install_targets
