# Helium Phase 1: Lockfile-First Install + Frozen Mode — Detailed Plan

## Goal
Make `skilltree install` use the lockfile as a resolution cache. Only re-resolve when the manifest changes. Implement `--frozen` for CI determinism.

## Current behavior (broken)
`installCommand` always calls `resolveAll()` which hits the network for every remote dep on every install. The lockfile is written but never read back for resolution.

## Target behavior (from spec)

| Scenario | Resolution? | Network? |
|----------|-------------|----------|
| No lockfile | Full resolution | Yes |
| Lockfile current, nothing changed | None — install from lockfile | Content fetch only |
| Manifest changed | Minimal — only new/changed entries | Yes (new repos) |
| Has local deps | Partial — remote from lockfile, local re-read | Maybe |
| `--frozen` | None — lockfile is sole truth | Content fetch at locked commits |

## Implementation

### 1. Manifest-Lockfile Diff (`src/core/lockfile.ts`)

New function `diffManifestLockfile(manifest, lockfile)` returns:
- `unchanged`: entries in lockfile that match manifest (same repo, path, compatible version)
- `added`: entries in manifest not in lockfile
- `changed`: entries in manifest that differ from lockfile (repo changed, version constraint changed)
- `removed`: entries in lockfile not in manifest

### 2. Selective Resolution (`src/core/graph.ts`)

New function `resolveWithLockfile(manifest, lockfile, projectDir)`:
- For `unchanged` remote deps: create ResolvedEntity directly from lockfile entry (no git fetch, no tag listing)
- For `unchanged` local deps: re-read frontmatter from filesystem, compare deps with lockfile entry
- For `added`/`changed`: full resolution via existing `resolveAll` logic
- Register all in resolution context so transitive deps work

### 3. Frozen Mode (`src/commands/install.ts`)

When `--frozen`:
- Read lockfile (error if missing)
- Compare manifest keys vs lockfile keys (error if mismatch)
- For remote deps: create ResolvedEntity from lockfile, fetch content at locked commit SHA
- For local deps: read from filesystem, error if frontmatter declares transitive dep not in lockfile
- Never write lockfile

### 4. Manifest Validation

Call `validateManifest()` at the start of `installCommand()`, before any resolution.

### 5. Error Preservation

Verify: if resolution fails (errors collected), the lockfile is not written. Current code throws before write — verify this is correct and add a test.

## Key design decisions
- Lockfile entries are keyed by YAML key (same as manifest keys) — diffing is direct key comparison
- "Compatible version" means the lockfile's resolved version satisfies the manifest's constraint
- Local deps ALWAYS re-read frontmatter regardless of lockfile state (Cargo pattern)
- `--frozen` is the strictest mode: no writes, no resolution, just install from lockfile
