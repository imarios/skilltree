# Phase 1: Test Plan — Agent Registry and Target Resolution

## Test File: `tests/core/agents.test.ts`

### resolveTarget
- [x] resolves "claude" to ".claude"
- [x] resolves "codex" to ".codex"
- [x] resolves all 6 known agents correctly
- [x] passes through "./custom" as literal path
- [x] passes through "/abs/path" as literal path
- [x] throws for unknown bare word "foo" with helpful message
- [x] error message includes suggestion to use ./foo

### resolveGlobalTarget
- [x] resolves "claude" to expanded ~/.claude
- [x] resolves "codex" to expanded ~/.codex
- [x] passes through literal paths unchanged
- [x] throws for unknown bare word

### pathToAgentName (reverse lookup)
- [x] maps ".claude" back to "claude"
- [x] maps ".codex" back to "codex"
- [x] returns null for unknown path ".custom"
- [x] maps all 6 known agent dirs back to names

### detectInstalledAgents
- [x] returns agent names for existing home directories
- [x] returns empty array when no agents installed
- [x] only returns agents that actually exist on disk

### getKnownAgentNames
- [x] returns all 6 agent names
- [x] returns sorted array

## Test File: `tests/core/manifest.test.ts` (additions)

### parseManifest — install_targets
- [x] parses install_targets as string array
- [x] parses manifest without install_targets (field absent)

### serializeManifest — install_targets
- [x] serializes install_targets to YAML
- [x] omits install_targets when not set

### validateManifest — install_targets conflicts
- [x] errors when both dev_install_path and install_targets present
- [x] allows install_targets alone
- [x] allows dev_install_path alone (backward compat)
- [x] allows neither (defaults apply)

## Test File: `tests/core/manifest.test.ts` or new `tests/core/install-targets.test.ts`

### getInstallTargets
- [x] returns resolved paths from install_targets (agent names resolved)
- [x] returns [".claude"] when neither install_targets nor dev_install_path set
- [x] returns [dev_install_path] when only dev_install_path set
- [x] handles mixed agent names and literal paths
- [x] throws for unknown agent name in install_targets
