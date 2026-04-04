# Phase 1: Short Memory

## All stubs implemented

### `src/core/agents.ts` (new file) ✅
- [x] `AGENT_REGISTRY` — built-in map constant
- [x] `resolveTarget(target: string): string` — Option E parser (project-level)
- [x] `resolveGlobalTarget(target: string): string` — Option E parser (global-level)
- [x] `pathToAgentName(path: string): string | null` — reverse lookup
- [x] `detectInstalledAgents(): Promise<string[]>` — check ~/.<agent>/ dirs
- [x] `getKnownAgentNames(): string[]` — return registry keys

### `src/types.ts` (modify) ✅
- [x] Add `install_targets?: string[]` to `Manifest`

### `src/core/manifest.ts` (modify) ✅
- [x] Parse `install_targets` in `parseManifest()`
- [x] Serialize `install_targets` in `serializeManifest()` (handled by YAML.stringify)
- [x] Validate no conflict in `validateManifest()`
- [x] `getInstallTargets(manifest): string[]` — new function with silent option
- [x] Deprecation warning for `dev_install_path` (emitted in `getInstallTargets` when falling back)
