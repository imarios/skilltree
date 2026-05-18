## v0.34.0 (2026-05-18)

### Feat

- **deps**: tree shows @<short-sha> for unpinned, commit in JSON, canonical names for aliases (#131)

## v0.33.1 (2026-05-18)

### Fix

- **doctor**: vacuous pass for empty deps; better error attribution; lsRemote LC_ALL=C; registry probe extended; RO3 test (#129)

## v0.33.0 (2026-05-17)

### Feat

- **cli**: authoring input-validation hardening (#71, #120, #122, #125, #126) (#127)

## v0.32.0 (2026-05-17)

### Feat

- **doctor**: preflight health check command (closes #84) (#113)

## v0.31.0 (2026-05-17)

### Feat

- **new**: scaffold new skill/agent/command with valid frontmatter (#112)

## v0.30.0 (2026-05-17)

### Feat

- **projects**: add `skilltree projects` read-only inspection command (#111)

## v0.29.3 (2026-05-17)

### Refactor

- **ui**: extract shared printTable helper for list/outdated (#105)

## v0.29.2 (2026-05-17)

### Fix

- **graph-readers**: resolve aliased entries in transitive walks (#106)
- **setup**: skip teach on post-merge bump (closes #92) (#104)

## v0.29.1 (2026-05-17)

### Fix

- **vendor**: record vendored target so unvendor can't silently mismatch (#103)

## v0.29.0 (2026-05-17)

### Feat

- **why**: add `skilltree why <name>` reverse-lookup command (#100)
- **outdated**: add read-only outdated command (closes #79) (#99)

## v0.28.1 (2026-05-17)

### Fix

- **info**: fall through to lockfile/manifest for installed deps (#98)

## v0.28.0 (2026-05-17)

### Feat

- **check**: lint local SKILL.md / agent / command frontmatter (#96)

## v0.27.6 (2026-05-17)

### Fix

- **init**: stop silently enrolling every detected agent (#95)

## v0.27.5 (2026-05-17)

### Fix

- **list**: surface resolved commit SHA for unpinned remote deps (#93)

## v0.27.4 (2026-05-17)

### Fix

- scan --apply merges into existing deps key instead of writing parallel block (#90)

## v0.27.3 (2026-05-17)

### Fix

- **vendor**: register & forward --target, fix error vocabulary (#69) (#88)

## v0.27.2 (2026-05-17)

### Fix

- update --dry-run no longer mutates skilltree.lock (#87)

## v0.27.1 (2026-05-16)

### Fix

- registry index --check accepts hand-authored entries for non-standard paths (#65)

## v0.27.0 (2026-05-14)

### Feat

- **cli**: add `remove -D, --dev` + tighten `teach --agent <agent>` (#23) (#61)

## v0.26.0 (2026-05-13)

### Feat

- **scan**: user-extensible ignore list via scan.ignore (#60)

## v0.25.4 (2026-05-13)

### Fix

- **registry**: rename skillkit-index.yaml to skilltree-index.yml (#58)

## v0.25.3 (2026-05-13)

### Fix

- **registry**: bare clones mirror branches and prune revoked tags (#55) (#56)

## v0.25.2 (2026-05-13)

### Refactor

- **manifest**: extract parseSourceEntry helper to drop cognitive complexity (#54)

## v0.25.1 (2026-05-04)

### Fix

- **scan**: ignore Claude Code built-in slash commands (#51)

## v0.25.0 (2026-05-03)

### Feat

- **manifest**: accept nested form for sources map (#50)

## v0.24.8 (2026-05-03)

### Fix

- **deps,lockfile**: preserve tree topology under duplicates; reject cyclic lockfiles (#47) (#48)

## v0.24.7 (2026-05-03)

### Fix

- **graph**: allow skill → command and skill → agent dependencies (#45) (#46)

## v0.24.6 (2026-05-03)

### Fix

- **add,search**: name typo'd --registry instead of misleading downstream errors (#42) (#44)

## v0.24.5 (2026-05-03)

### Fix

- **remove**: clean files from all install_targets, not just the first (#41)

## v0.24.4 (2026-05-03)

### Fix

- **scan**: detect XML and call-form Skill references (#34) (#37)

## v0.24.3 (2026-05-03)

### Fix

- **targets**: keep .gitignore in sync on add/remove/detect (#33) (#38)

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
