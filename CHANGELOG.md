## v0.16.0 (2026-04-19)

### Feat

- cross-repo transitive resolution via origin manifest (R7)

## v0.15.0 (2026-04-19)

### Feat

- informative error when transitive dep is upstream dev-only
- resolve transitive deps via origin repo's skilltree.yaml

### Refactor

- rename analysi-backend references to nested-source-layout

## v0.14.3 (2026-04-18)

### Fix

- filter common English stopwords from regex scan matches

## v0.14.2 (2026-04-16)

### Fix

- display LLM suggestions in scan output when no undeclared deps found

## v0.14.1 (2026-04-14)

### Fix

- add codecov config and upload coverage on PRs

## v0.14.0 (2026-04-07)

### Feat

- auto-run make setup after version bumps via post-merge hook

## v0.13.1 (2026-04-06)

### Fix

- correct install paths for codex, copilot, and windsurf targets

## v0.13.0 (2026-04-05)

### Feat

- auto-index on registry add, revamp demo, split make demo target

## v0.12.0 (2026-04-05)

### Feat

- teach uses global dependency pipeline (Beryllium Phase 6)
- teach auto-detects agents, init uses install_targets (Beryllium Phase 4)
- multi-target install support (Beryllium Phase 3)
- add skilltree targets subcommand (Beryllium Phase 2)
- add agent registry and install_targets support (Beryllium Phase 1)

### Fix

- address Beryllium backlog — stale targets, vendor guard, global flag, migration guide
- warn in make setup when npm-installed skilltree is also on PATH

## v0.11.2 (2026-04-04)

### Fix

- sync package.json version and fix cz version_files pattern

## v0.11.1 (2026-04-04)

### Fix

- add npm publish job to release workflow

## v0.11.0 (2026-04-04)

### Feat

- automated release pipeline with commitizen

## v0.10.1 (2026-04-03)

### Fix

- ESM-compatible bin shim, bump to 0.10.1

## v0.9.0 (2026-04-03)

### Feat

- initial commit
