# Beryllium - Multi-Agent Support

Project-Type: production
Sub-Project: Beryllium (started 04/04/2026)

Spec: [docs/specs/multi-agent.md](../../specs/multi-agent.md)

## Phase 1: Agent Registry and Target Resolution ✅ COMPLETE

Core data layer — the agent registry, target parsing (Option E), and manifest changes for `install_targets`. No install behavior changes yet.

### Tasks
- [x] Agent registry module (`src/core/agents.ts`) — built-in map of agent names → paths (project-level and global home), `resolveTarget()` function, error for unknown names
- [x] Reverse lookup — `pathToAgentName()` maps `.claude` → `claude`, unknown paths return null
- [x] Target parser — bare word → agent lookup, `./` or `/` prefix → literal path
- [x] Agent detection — `detectInstalledAgents()` checks for `~/.<agent>/` directories
- [x] Manifest changes — `install_targets` field in `Manifest` type, parsing, serialization
- [x] Validation — error if both `dev_install_path` and `install_targets` present
- [x] Deprecation warning when `dev_install_path` is used (suggest migration to `install_targets`)
- [x] Backward compat — when neither field present, default to `[claude]`

## Phase 2: `skilltree targets` Subcommand ✅ COMPLETE

CLI for managing install targets without editing YAML.

### Tasks
- [x] `skilltree targets list` — table showing detected/configured agents + custom paths
- [x] `skilltree targets add <name|path>` — add target to `install_targets` in manifest, validate, reject duplicates
- [x] `skilltree targets remove <name|path>` — remove target, error if last target
- [x] `skilltree targets detect` — scan for installed agents, add missing ones
- [x] `skilltree targets migrate` — convert `dev_install_path` → `install_targets` using reverse lookup (`.claude` → `claude`, `.custom` → `./custom`), remove `dev_install_path`
- [x] Guard — `add/remove/detect` error if `dev_install_path` is set, direct to `targets migrate`
- [ ] `--global` flag — `targets` subcommands work on global manifest too (deferred to Phase 4)
- [x] CLI wiring (`src/cli.ts`) — `targets` parent command with subcommands

## Phase 3: Multi-Target Install ✅ COMPLETE

Wire `install_targets` into the install pipeline — install to each target independently.

### Tasks
- [x] Installer loop — iterate over resolved targets, run install for each
- [x] Local deps — one symlink per target, each pointing to source
- [x] Remote deps — one copy per target (or symlink to cache if available)
- [ ] Global install — agent names resolve to global home paths (deferred to Phase 4)
- [x] `--install-path` override — kept as single-target one-off, overrides `install_targets` for that invocation
- [ ] Stale target detection — if lockfile records targets not in current `install_targets`, warn (deferred to Phase 5)
- [x] Lockfile — record `install_targets` in lockfile
- [ ] Vendor — single target only; require `--target <name>` when multiple targets configured (deferred to Phase 5)
- [x] Output — show which targets were installed to

## Phase 4: Teach as Global Dep + Init Detection ✅ COMPLETE

Rewrite `teach` to use skilltree's own global dep mechanism. `init` auto-detects agents.

### Tasks
- [ ] Refactor `teach` to use global deps (deferred — current direct copy approach made agent-aware instead)
- [x] `teach` auto-detection — detect agents, install to all by default
- [x] `teach --agent <name>` flag — restrict to specific agent
- [x] No agents detected — error with helpful message
- [ ] Verify the skilltree skill appears in global lockfile as a proper dependency (deferred with teach-as-global-dep)
- [x] `skilltree init` — auto-detect agents, pre-populate `install_targets`, fallback to `[claude]`
- [ ] Update `make setup` to use new teach behavior

## Phase 5: Polish ✅ COMPLETE

Error messages, documentation, migration guide.

### Tasks
- [x] Error message quality — reviewed, all error paths have clear messages
- [ ] Migration guide — document `dev_install_path` → `install_targets` migration (deferred to separate doc)
- [x] README update — multi-agent usage examples, `targets` command docs
- [x] Completion updates — `targets` and `--agent` flag completions (done in Phase 2 and 4)
