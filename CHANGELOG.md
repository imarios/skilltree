## v0.24.2 (2026-05-03)

### Fix

- **init**: resolve .gitignore entries through agent registry (#32) (#35)

## v0.24.1 (2026-05-02)

### Fix

- **install**: polish output + harden tests (#27) (#30)

## v0.24.0 (2026-05-02)

### Feat

- **add**: apply --type filter during registry resolution and glob expansion (#22) (#29)

## v0.23.3 (2026-05-02)

### Fix

- **install**: print 'Install order' once + friendly per-target labels (#20) (#28)

## v0.23.2 (2026-05-02)

### Fix

- **cache**: fingerprint registry index cache by scanner version (#25) (#26)

## v0.23.1 (2026-05-02)

### Fix

- **scanner**: index slash-commands in registry + repo scans (#21) (#24)

## v0.23.0 (2026-05-02)

### Feat

- **add**: support glob patterns for batch registry adds (#19)

## v0.22.1 (2026-05-02)

### Fix

- **ci**: set explicit GITHUB_TOKEN permissions on CI workflow (#17)

## v0.22.0 (2026-05-02)

### Feat

- **scan**: detect slash-command references + command parity polish (#16)

## v0.21.0 (2026-05-02)

### Feat

- **commands**: add slash commands as a third resource type (#13)

## v0.20.0 (2026-04-29)

### Feat

- **manifest**: make .yml the default extension (#12)

## v0.19.1 (2026-04-28)

### Fix

- **teach,completion**: make skilltree usable when installed globally (#10)

## v0.19.0 (2026-04-25)

### Feat

- **manifest**: accept skilltree.yml alongside skilltree.yaml

## v0.18.2 (2026-04-22)

### Fix

- **graph**: warn when origin manifest is on main but missing at tag

## v0.18.1 (2026-04-22)

### Fix

- **init**: make non-interactive fallback test TTY-independent

## v0.18.0 (2026-04-22)

### Feat

- **init**: add --scan to discover in-tree skills and agents

### Fix

- **git**: invalidate cache when origin URL drifts
- **add**: print install hint after success

## v0.17.0 (2026-04-21)

### Feat

- **boron**: origin-manifest resolution for direct deps

### Fix

- **boron-phase-5**: 5-round refinement of the systemic hardening
- **boron**: harden origin-manifest resolution from 5 rounds of review

### Refactor

- **boron-phase-5**: round 6/7 refinement — coverage + type safety
- **boron**: phase 5 — systemic hardening from review patterns

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
