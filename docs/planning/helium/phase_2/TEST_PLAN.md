# Helium Phase 2: Test Plan

## Selective update
- [ ] `update` without name: re-resolves everything (existing behavior but via lockfile delete + install)
- [ ] `update task-builder`: only re-resolves that dep's repo entries, keeps rest from lockfile

## Remove interactive prompt
- [ ] With dependents and no --force: prompts user (mock stdin for test)
- [ ] With --force: skips prompt, removes anyway

## Duplicate composite key detection
- [ ] Two manifest entries resolving to same (type, name): produces error
- [ ] Same key appearing in dev group (group upgrade): no error
