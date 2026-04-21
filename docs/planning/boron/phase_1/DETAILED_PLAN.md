# Phase 1 Detailed Plan — Path-Optional Direct Deps

**Spec ref:** [origin_manifest_resolution.md](../../../specs/origin_manifest_resolution.md) §R9, R11, R12

## Goal

Allow direct `RemoteDependency` / `SourceDependency` entries to omit `path:`. When omitted, infer the path from origin's `skilltree.yaml` (declarative → primary) or the conventional probe (fallback). When neither works, emit a clear error.

## Scope

- Schema: `path` becomes optional on remote/source deps; add `force_path` (unused in this phase, introduced here so Phase 2 only adds warning logic).
- Validation: remove the `path:` required check for remote/source deps.
- Resolver: add `inferDirectDepPath` helper, invoke from `resolveRemoteEntity` when `dep.path` missing.
- Tests: 13 R9 scenarios in a new test file.

## Files Touched

| File | Change |
|------|--------|
| `src/types.ts` | `RemoteDependency.path?: string`, `SourceDependency.path?: string`, `force_path?: boolean` on both. `LockfileEntry.path` stays required (we always record the resolved path). |
| `src/core/manifest.ts` | `validateManifest`: drop "remote dependencies require a `path:` field" error. `parseManifest`: preserve `force_path`. `serializeManifest`: preserve `force_path`. |
| `src/core/graph.ts` | New `inferDirectDepPath(dep, parentCompositeKey, state)`. Called from `resolveRemoteEntity` when `dep.path` missing. New error when inference fails. |
| `tests/core/graph-direct-path-inference.test.ts` | New file. 13 R9 tests per spec Testing Checklist. |

## Resolver Change Detail

`resolveRemoteEntity` currently:

```typescript
let entityPath = dep.path;          // ← assumes path is present
const exists = await pathExistsAtRef(resolution.cachePath, ref, normalizedPath);
if (!exists) { error(); return; }
```

After:

```typescript
let entityPath = dep.path;
if (!entityPath) {
  entityPath = await inferDirectDepPath(dep, yamlKey, entityName, resolution, state);
  if (!entityPath) {
    state.errors.push(`Error: "${entityName}" has no path, could not infer from origin manifest or convention probe...`);
    return;
  }
}
// ... rest unchanged
```

`inferDirectDepPath` algorithm (matches spec R9):

1. Read origin's `skilltree.yaml` at resolved ref. Silent bail on read/parse failures.
2. `expanded = expandSources(originManifest)`. Look up `entityName` in `expanded.dependencies` (never dev-dependencies).
3. If origin entry is `local:` relative → return `stripDotSlash(local)`.
4. If origin entry is `local:` absolute → return null (caller continues to convention probe).
5. If origin entry is `repo:` matching `dep.repo` → return origin's `path`.
6. If origin entry is `repo:` mismatching → return null (don't redirect).
7. If no entry in origin → fall through to convention probe.
8. Convention probe: try `skills/<entityName>/SKILL.md`, `agents/<entityName>.md`, `<entityName>/SKILL.md` at the ref. Return the matching path without `SKILL.md`.
9. Return null (caller produces R9 error).

## Security Pre-Review

- **Path traversal:** origin's `skilltree.yaml` is untrusted input. `stripDotSlash` removes `./` but does NOT block `../`. An origin could declare `local: ../../../etc/passwd`. Today, `pathExistsAtRef` reads from the git cache via `git show <ref>:<path>`, which git itself sanitizes — paths with `..` that escape the repo do not resolve in git's object tree. So the attack surface is contained to paths within the origin's own repo tree. **Acceptable**, but add a defensive check: reject inferred paths containing `..` segments with a clear error.
- **YAML parse errors:** `parseManifest` throws on invalid YAML. We catch silently → fall-through. No crash.
- **DoS via huge origin manifest:** origin manifests are small text files; git's cache already limits object size. Not a practical concern.

## Phase-specific DoD

- All R9 tests pass.
- Full `bun test` suite green.
- Biome lint clean. tsc strict clean.
- No container/DB/API changes → no extended checks.
