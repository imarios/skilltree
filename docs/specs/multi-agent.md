# Multi-Agent Support

+++
version = "1.2"
date = "2026-04-04"
status = "draft"

[[changelog]]
version = "1.2"
date = "2026-04-04"
summary = "Added skilltree targets subcommand, replaced init-only detection"

[[changelog]]
version = "1.1"
date = "2026-04-04"
summary = "Resolved Q1-Q3, teach uses global deps, init auto-detects"

[[changelog]]
version = "1.0"
date = "2026-04-04"
summary = "Initial spec"
+++

## Problem Statement

skilltree installs skills to a single directory (default `.claude/`). Users who work with multiple AI coding agents (Claude Code, Codex, Cursor, Copilot, Gemini CLI, Windsurf) must run `skilltree install` multiple times with different `--install-path` flags or maintain separate manifests. The `skilltree teach` command is hardcoded to `~/.claude/skills/` only. As the SKILL.md standard gains adoption across 16+ tools, skilltree should make multi-agent support a first-class experience.

## Goals & Non-Goals

### Goals

- **G1**: Single `skilltree install` deploys skills to multiple agent directories
- **G2**: `skilltree teach` manages the skilltree skill as a proper global dependency (not a special-case copy)
- **G3**: Known agent names resolve to conventional paths (e.g., `claude` → `.claude`)
- **G4**: Custom paths supported for unknown agents or non-standard setups
- **G5**: Backward compatible with existing `dev_install_path` (warn to migrate)
- **G6**: `skilltree targets` subcommand for managing install targets without editing YAML

### Non-Goals

- Agent-specific skill transformations (all agents use the same SKILL.md format)
- Managing agent-specific config files (`.cursorrules`, `GEMINI.md`, etc.)

## Requirements

### Agent Registry

- **R1**: An agent registry maps known agent names to their conventional directory paths
- **R2**: Each target is either a known agent name (bare word) or a literal path (starts with `./` or `/`)
- **R3**: Unknown bare words produce a clear error: `unknown agent 'foo' — use ./foo for a custom path`

### Manifest: `install_targets`

- **R4**: The manifest supports an `install_targets` field accepting a list of targets
- **R5**: `install_targets` defaults to `[claude]` when absent (backward compat with existing projects)
- **R6**: `dev_install_path` continues to work but emits a deprecation warning suggesting `install_targets`
- **R7**: If both `dev_install_path` and `install_targets` are present, error with a clear message

### Install Behavior

- **R8**: `skilltree install` installs to every target in `install_targets`, independently (no symlinks between agents)
- **R9**: For local deps, each target gets its own symlink pointing to the source; for remote deps, each target gets its own copy (or symlink to cache)
- **R10**: The lockfile records which targets were installed to (for `skilltree verify` and idempotent reinstall)
- **R10a**: If the lockfile records targets that are no longer in `install_targets`, `skilltree install` warns: `stale target .codex/ still has installed skills — run skilltree clean .codex to remove`. No automatic deletion.
- **R10b**: `--install-path` CLI flag is kept as a one-off single-target override. When used, it overrides `install_targets` for that invocation only (useful for CI/scripts). It does not modify the manifest.

### `skilltree targets` Subcommand

- **R11**: `skilltree targets list` shows all known agents with two indicators: detected on system, and present in `install_targets`. Also shows custom paths from `install_targets`.
- **R12**: `skilltree targets add <name|path>` adds a target to `install_targets` in `skilltree.yml`
- **R13**: `skilltree targets remove <name|path>` removes a target from `install_targets`
- **R14**: `skilltree targets detect` scans for installed agents and adds any missing ones to `install_targets`
- **R15**: `skilltree targets migrate` converts `dev_install_path` → `install_targets` and removes `dev_install_path` from the manifest. Known paths are reverse-looked-up to agent names (`.claude` → `claude`); unknown paths become literal (`./custom` → `./custom`)
- **R16**: `targets add/remove/detect` error if `dev_install_path` is still set, directing the user to run `skilltree targets migrate` first

### Global Manifest

- **R17**: The global manifest (`~/.skilltree/global.yaml`) supports `install_targets` with the same semantics. Agent names resolve to global home paths (`claude` → `~/.claude`) rather than project-relative paths.
- **R18**: `targets` subcommand works with `--global` flag to manage the global manifest's `install_targets`

### Vendor

- **R19**: `skilltree vendor` operates on a single target only. If `install_targets` has multiple entries, vendor requires `--target <name>` to select one. Vendoring to multiple targets would double committed files — this is intentional.

### `skilltree init`

- **R20**: `skilltree init` auto-detects agents and pre-populates `install_targets` in the new `skilltree.yml`. Falls back to `[claude]` if none detected.

### `skilltree teach`

- **R21**: `skilltree teach` is sugar for adding the bundled skilltree skill as a global dependency — it calls `skilltree add --global` and `skilltree install --global` internally
- **R22**: `skilltree teach` auto-detects agents by checking for `~/.<agent>/` directories and installs to all detected agents by default
- **R23**: `skilltree teach --agent <name>` restricts to a specific agent

## Data Model

### Agent Registry

Built-in map, not user-configurable (users use literal paths for custom agents):

| Agent Name | Directory | Global Home |
|------------|-----------|-------------|
| `claude`   | `.claude` | `~/.claude` |
| `codex`    | `.codex`  | `~/.codex`  |
| `cursor`   | `.cursor` | `~/.cursor` |
| `copilot`  | `.copilot`| `~/.copilot`|
| `gemini`   | `.gemini` | `~/.gemini` |
| `windsurf` | `.windsurf`| `~/.windsurf`|

### Manifest Changes

```yaml
# Before (single target — deprecated)
dev_install_path: .claude

# After (multi-target)
install_targets:
  - claude
  - codex

# Custom path mixed in
install_targets:
  - claude
  - ./custom-agent
```

### Target Resolution (Option E)

| Input | Interpretation | Resolved Path |
|-------|---------------|---------------|
| `claude` | Agent name lookup | `.claude` |
| `codex` | Agent name lookup | `.codex` |
| `./myagent` | Literal path | `./myagent` |
| `/abs/path` | Literal path | `/abs/path` |
| `foo` | Unknown agent → **error** | — |

Rule: starts with `.` or `/` → literal path. Otherwise → agent name lookup.

### Lockfile Changes

```yaml
# New: record install targets
install_targets:
  - .claude
  - .codex
```

## `skilltree targets` CLI Examples

```
$ skilltree targets list
Detected     In targets   Name        Path
  ✔            ✔          claude      .claude
  ✔                       codex       .codex
               ✔          ./custom    ./custom
                          cursor      .cursor
                          copilot     .copilot
                          gemini      .gemini
                          windsurf    .windsurf

$ skilltree targets add codex
Added codex to install_targets.

$ skilltree targets add ./my-agent
Added ./my-agent to install_targets.

$ skilltree targets remove codex
Removed codex from install_targets.

$ skilltree targets detect
Detecting agents... found claude, codex
Added codex to install_targets (claude already present).

$ skilltree targets add codex
Error: cannot modify install_targets while dev_install_path is set.
Run: skilltree targets migrate

$ skilltree targets migrate
Migrated dev_install_path: .claude → install_targets: [claude]
Removed dev_install_path from skilltree.yml.
```

## Constraints

- Must not break existing `dev_install_path` workflows — deprecation warning only
- Agent registry is compiled into the binary (no network calls, no config files)
- Each agent target is fully independent — no cross-linking between agent directories
- The `teach` command must work offline (no registry lookups)

## Error Handling

| Scenario | Behavior | User Impact |
|----------|----------|-------------|
| Unknown agent name in `install_targets` | Error: `unknown agent 'foo' — use ./foo for a custom path` | User fixes manifest |
| Both `dev_install_path` and `install_targets` present | Error: `cannot use both dev_install_path and install_targets — migrate to install_targets` | User removes one |
| `targets add` with duplicate | Warning: `codex already in install_targets` | No-op |
| `targets remove` last target | Error: `cannot remove last target — at least one required` | User keeps one |
| `targets add/remove/detect` with `dev_install_path` set | Error: `cannot modify install_targets while dev_install_path is set. Run: skilltree targets migrate` | User migrates first |
| `targets migrate` with no `dev_install_path` | Warning: `nothing to migrate — dev_install_path not set` | No-op |
| `teach` finds no agents | Error: `no agents detected — use --agent <name> or install an agent first` | User specifies manually |
| `teach` finds multiple agents | Installs to all detected agents (default behavior) | User sees list of targets |
| Stale target in lockfile | Warning: `stale target .codex/ still has installed skills — run skilltree clean .codex to remove` | User cleans up manually |
| `--install-path` with `install_targets` | `--install-path` overrides for this invocation only | Single-target one-off |
| `vendor` with multiple targets, no `--target` | Error: `vendor requires --target <name> when multiple install targets are configured` | User picks one |
| Custom path doesn't exist | Warning + create directory (same as current behavior) | Directory created |

## Testing Checklist

### Agent Registry
- [ ] Resolves all known names to correct paths
- [ ] Unknown agent name errors with helpful message
- [ ] Literal paths (`./` and `/` prefix) pass through unchanged

### Install Targets
- [ ] `install_targets` with single agent installs correctly
- [ ] `install_targets` with multiple agents installs to each independently
- [ ] Mixed agent names and literal paths work together
- [ ] `dev_install_path` still works with deprecation warning
- [ ] Both `dev_install_path` and `install_targets` present → error
- [ ] Absent `install_targets` defaults to `[claude]`
- [ ] Lockfile records install targets
- [ ] `vendor` works with `install_targets`
- [ ] `vendor` with multiple targets requires `--target`
- [ ] `vendor` with single target works without `--target`
- [ ] Global install works with `install_targets`
- [ ] Global manifest resolves agent names to global home paths (`~/.claude`)
- [ ] `--install-path` overrides `install_targets` for single invocation
- [ ] Stale target in lockfile warns on install (no auto-delete)

### `skilltree targets`
- [ ] `targets list` shows detected + configured agents
- [ ] `targets add <agent>` adds to manifest
- [ ] `targets add <path>` adds custom path to manifest
- [ ] `targets remove <agent>` removes from manifest
- [ ] `targets remove` last target → error
- [ ] `targets detect` finds and adds missing agents
- [ ] `targets detect` skips already-present agents
- [ ] `targets migrate` converts `dev_install_path` to `install_targets`
- [ ] `targets migrate` removes `dev_install_path` from manifest
- [ ] `targets migrate` with no `dev_install_path` warns and does nothing
- [ ] `targets add/remove/detect` errors when `dev_install_path` is set
- [ ] `targets migrate` reverse-lookups known paths (`.claude` → `claude`)
- [ ] `targets migrate` falls back to literal for unknown paths (`.custom` → `./custom`)

### `skilltree init`
- [ ] Auto-detects agents and populates `install_targets`
- [ ] Falls back to `[claude]` when no agents detected

### `skilltree teach`
- [ ] Auto-detect with one agent installs there
- [ ] Auto-detect with multiple agents installs to all (default)
- [ ] `teach --agent claude` restricts to claude only
- [ ] With no agents found, errors helpfully
- [ ] Adds skilltree as a global dep (not a manual copy)

## Resolved Questions

- **Q1**: Should `skilltree add` show which agents will receive the skill? **No** — `add` modifies the manifest; `install_targets` already defines the targets. No extra output needed.
- **Q2**: Should `install_targets` default to `[claude]` when absent? **Yes** — backward compat. Existing projects without `install_targets` behave exactly as before.
- **Q3**: Should `teach --all` be the default when multiple agents are detected? **Yes** — `teach` installs to all detected agents by default. `--agent <name>` to restrict.
- **Q4**: Should `teach` use skilltree's own global dep mechanism? **Yes** — `teach` becomes sugar for `add --global` + `install --global`. The skilltree skill is a proper global dep, not a special-case copy. Updates flow through normal `skilltree update`.
- **Q5**: When does auto-detection happen? **At `init` time** (pre-populate `install_targets`), at `targets detect` time (re-scan), and at `teach` time (detect global agent homes). Not at `add` or `install` time — those follow the manifest.
- **Q6**: How do users manage targets without editing YAML? **`skilltree targets {list,add,remove,detect}`** subcommand. Same pattern as `skilltree registry`.

## Future Work

- User-configurable agent registry entries (for new agents before skilltree adds them)
- Per-agent skill exclusions (install skill X only for claude, not codex)
- `skilltree doctor` command that checks all agent directories for consistency
