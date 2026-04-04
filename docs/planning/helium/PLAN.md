# Helium - Spec Compliance

Project-Type: production
Sub-Project: Helium (started 03/30/2026)

## Phase 1: Lockfile-First Install + Frozen Mode ✅ COMPLETE

The core behavioral gap. Install must use the lockfile as a cache and only re-resolve when manifest changes.

### Tasks
- [x] Lockfile diffing — detect what changed between manifest and existing lockfile
- [x] Lockfile-first resolution — skip resolution for unchanged remote deps, always re-read local deps
- [x] `--frozen` mode — error if manifest/lockfile out of sync, skip version resolution, fetch content at locked commits only, error if local dep adds new transitive dep not in lockfile
- [x] Manifest validation — call `validateManifest()` before resolution in the install flow
- [x] Failed install preserves lockfile — verified: error thrown before lockfile write

## Phase 2: Update, Remove, and Validation Fixes ✅ COMPLETE

Fix the commands that don't fully match spec behavior.

### Tasks
- [x] `update [name]` — selective update: clears same-repo entries from lockfile, re-resolves only those
- [x] `remove` interactive prompt — prompt `[y/N]` via readline when dependents exist
- [x] Duplicate composite key detection — error when two manifest entries resolve to same `(type, name)`
