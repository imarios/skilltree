# Phase 1: Agent Registry and Target Resolution — Detailed Plan

## Overview

Build `src/core/agents.ts` with the agent registry, target resolution, and detection. Extend `Manifest` type with `install_targets`. Add validation and backward compat logic to the manifest module.

## Files to Create

### `src/core/agents.ts`
The central module for this phase. Contains:

1. **`AGENT_REGISTRY`** — `Record<string, { dir: string; globalHome: string }>` mapping agent names to paths:
   ```ts
   claude  → { dir: ".claude",   globalHome: "~/.claude" }
   codex   → { dir: ".codex",    globalHome: "~/.codex" }
   cursor  → { dir: ".cursor",   globalHome: "~/.cursor" }
   copilot → { dir: ".copilot",  globalHome: "~/.copilot" }
   gemini  → { dir: ".gemini",   globalHome: "~/.gemini" }
   windsurf→ { dir: ".windsurf", globalHome: "~/.windsurf" }
   ```

2. **`resolveTarget(target: string): string`** — Option E parser:
   - Starts with `./` or `/` → return as-is (literal path)
   - Otherwise → look up in AGENT_REGISTRY, return `dir`
   - Not found → throw with message: `unknown agent '${target}' — use ./${target} for a custom path`

3. **`resolveGlobalTarget(target: string): string`** — Same but returns `globalHome` (expanded tilde)

4. **`pathToAgentName(path: string): string | null`** — Reverse lookup:
   - `.claude` → `claude`, `.codex` → `codex`, etc.
   - Unknown → `null`

5. **`detectInstalledAgents(): string[]`** — Check for `~/.<agent>/` directories, return list of names

6. **`getKnownAgentNames(): string[]`** — Return all registry keys (for completions, list display)

## Files to Modify

### `src/types.ts`
- Add `install_targets?: string[]` to `Manifest` interface

### `src/core/manifest.ts`
- **`parseManifest()`**: Parse `install_targets` field from YAML
- **`serializeManifest()`**: Serialize `install_targets` back to YAML
- **`validateManifest()`**: Add validation — error if both `dev_install_path` and `install_targets` present
- **`getDevInstallPath()`**: When `install_targets` is set, this function should still work for backward compat (resolve first target). Add deprecation warning when `dev_install_path` is used.
- **`getInstallTargets(manifest)`**: New function — returns resolved paths from `install_targets`, or falls back to `[getDevInstallPath(manifest)]` for backward compat

## Security Pre-Review

- No auth boundaries affected
- No secrets handling
- No network calls (registry is compiled in)
- Agent detection reads only directory existence — no file contents
- Low risk phase

## Phase-Specific Definition of Done

- `src/core/agents.ts` exists with all functions
- All 6 agents resolve correctly (both project and global paths)
- Unknown agent names produce clear errors
- Literal paths pass through unchanged
- `install_targets` parses and serializes in manifests
- Both `dev_install_path` and `install_targets` present → error
- `dev_install_path` alone → deprecation warning
- Neither present → defaults to `[claude]`
- Detection finds agents that exist on disk
- All existing tests still pass (no regressions)
