# Origin-Manifest Resolution

+++
version = "2.0"
date = "2026-04-21"
status = "active"

[[changelog]]
version = "1.0"
date = "2026-04-18"
summary = "Initial spec — origin-manifest lookup for transitive deps (local: entries)."

[[changelog]]
version = "1.1"
date = "2026-04-19"
summary = "R7 shipped — cross-repo entries (repo:/source:) in origin's manifest are resolved on-demand."

[[changelog]]
version = "2.0"
date = "2026-04-21"
summary = "Extended to direct deps (R9). Consumers can omit path: and inherit it from origin's manifest. Redundancy/override warnings (R10) with force_path opt-out. Spec renamed from transitive_origin_manifest.md."
+++

## Problem Statement

Origin repos that ship a `skilltree.yml` already declare, authoritatively, where every skill and agent they own lives. Transitive resolution (v1.x of this spec) leveraged that manifest to auto-resolve dependencies that downstream consumers didn't declare themselves. But for **direct** deps, consumers still have to specify `path:` explicitly — duplicating information origin already provided.

Concrete friction: a consumer writes

```yaml
dependencies:
  task-builder:
    repo: file:///.../backendv2-y
    path: skills/source/task-builder  # <-- this information is in origin's manifest
  task-naming:
    repo: file:///.../backendv2-y
    path: skills/source/task-naming   # <-- same story
```

Every entry repeats a path the origin already told the world about. If origin renames or reorganizes, every consumer has to update. This spec extends origin-manifest lookup to direct deps so consumers only declare `repo:` (or `source:`) and let origin's manifest supply the path.

## Goals & Non-Goals

### Goals

- Consumers omit `path:` on direct deps when origin's manifest declares the name; skilltree fills it in.
- Warn when consumer's explicit `path:` is redundant (matches origin's declaration) or overriding (differs from origin's declaration), so users can clean up manifests and stay aware of forks.
- Provide an opt-out (`force_path: true`) for intentional overrides that should not trigger warnings.
- Preserve every existing behavior: convention-layout repos, transitive resolution (v1.x), dev-dep gating.

### Non-Goals

- Inferring `repo:` itself. Consumers still have to say who owns the skill. (Registries are the authoring-time tool for that.)
- Inferring `name:` in alias scenarios. If consumer aliases a YAML key, they still provide `name:`.
- Rewriting origin's path when origin's entry redirects to a **different** repo. Consumer's `repo:` stays authoritative for where to fetch; origin's cross-repo entry for the same name causes fall-through rather than silent redirect.

## Requirements

### Carried forward from v1.x (transitive resolution)

- **R1**: When a transitive dep cannot be found in the consumer's manifest, the already-resolved context, or the parent's local source, the resolver MUST consult the origin repo's `skilltree.yml` (read at the parent's pinned git ref) before falling back to the conventional path probe.
- **R2**: If the origin manifest declares the dep name under `dependencies:` with a `local:` entry, the resolver MUST synthesize a same-repo remote dep (`{repo: parentRepo, path: stripDotSlash(local)}`) pinned to the parent's resolved tag and resolve it.
- **R3**: If the origin manifest is missing, unreadable, or malformed, the resolver MUST silently fall through to the conventional probe.
- **R4**: The resolver MUST NOT expose `dev-dependencies` declared in the origin manifest. Transitive deps only in origin's `dev-dependencies` fail with an informative error (R5).
- **R5**: When all lookup tiers fail, the error message MUST enumerate every location the resolver checked. If the dep was in origin's `dev-dependencies`, the error MUST hint at the upstream author.
- **R6**: The conventional same-repo probe MUST still run after origin-manifest lookup, preserving zero-config behavior.
- **R7**: Cross-repo entries in origin's manifest MUST be resolved on-demand. An already-resolved repo is reused when origin's constraint is satisfied; otherwise a constraint-conflict error fires.
- **R8**: An origin manifest entry whose `local:` path is absolute MUST be skipped silently (fall through to the conventional probe).

### New in v2.0 (direct deps)

- **R9**: A direct dep with `repo:` (or `source:`-expanded-to-`repo:`) MAY omit `path:`. When omitted, the resolver MUST look up the actual entity name in the origin repo's `skilltree.yml`:
  - If origin declares the name under `dependencies:` with a `local:` entry whose path is relative, use that path within the consumer-declared repo.
  - If origin declares the name under `dependencies:` with a `repo:` entry pointing at the **same** repo the consumer declared, use origin's path.
  - If origin declares the name under `dependencies:` with a `repo:` entry pointing at a **different** repo, fall through (do not redirect — consumer's `repo:` wins).
  - If origin does not declare the name, fall through to the conventional probe (`skills/<name>/SKILL.md`, `agents/<name>.md`, `<name>/SKILL.md`).
  - If all tiers fail, error with a message listing every location checked and a `Fix:` hint to either add `path:` or seed the origin manifest.
- **R10**: When the consumer supplies an explicit `path:` and origin's manifest also declares the same name under `dependencies:`, the resolver MUST emit a warning:
  - **Redundant**: consumer's `path:` equals origin's `local:` (stripped) or origin's `path:` (same-repo `repo:`). Warning recommends omitting `path:`.
  - **Override**: consumer's `path:` differs from origin's declared path. Warning names both paths and suggests `force_path: true` if the override is intentional.
- **R11**: A dependency entry MAY include `force_path: true` to silence R10 warnings for that entry. `force_path` has no other effect on resolution.
- **R12**: Manifest validation (`validateManifest`) MUST NOT require `path:` on remote dependencies. The existing requirement that `repo:`/`source:` and `local:` are mutually exclusive stays.
- **R13**: `skilltree add --repo <url>` (and `--source <alias>`) MUST accept an omitted `--path`. If the origin manifest resolves the path at add-time, it MAY be written into the consumer's manifest; otherwise the manifest is written with no `path:` and resolution happens at install-time.
- **R14 (stale-tag manifest)**: For each resolved remote repo, the resolver MUST check whether `skilltree.yml` exists at the resolved tag. If it is absent at the tag but present on the default branch, the resolver MUST emit a single warning per repo that names the repo, the resolved tag, the default branch, and recommends cutting a new tag. This guards the common case where an author commits a manifest to `main` without tagging a release, so consumers silently lose R9/R10 signals.

## Constraints

### Resolution order (direct deps, new)

Today: `resolveRemoteEntity()` requires `dep.path` and calls `pathExistsAtRef()` to validate.

After R9: when `dep.path` is missing, the resolver runs a path-inference tier **before** validation:

1. **Origin-manifest lookup** — read origin's `skilltree.yml` at the resolved tag, look up the entity name in `dependencies`, use its declared path (subject to R9 rules).
2. **Conventional probe** — try `skills/<name>/SKILL.md`, `agents/<name>.md`, `<name>/SKILL.md` at the consumer's declared repo.
3. **Error** — missing path + no origin lookup + no probe match → clear error naming every location checked.

Transitive resolution order is unchanged (still 6 tiers, per v1.x).

### Synthesized dep shape for direct deps (R9)

| Origin entry (in `dependencies:`) | Inferred `path:` |
|-----------------------------------|------------------|
| `local: ./path/in/repo` | `stripDotSlash(./path/in/repo)` (used within consumer's declared repo) |
| `local:` with absolute path | Fall through to convention probe (matches R8 philosophy) |
| `repo:` pointing at consumer-declared repo | Origin's `path:` |
| `repo:` pointing at a different repo | Fall through to convention probe |

### Warning semantics (R10)

Let `C` be consumer's declared `path:`, `O` be origin's declared path (`stripDotSlash(local)` or `repo.path`).

- `C == O` → Redundant warning (once per entry, at install time).
- `C != O` and origin declares the name same-repo → Override warning (once per entry).
- Origin does not declare the name → no warning.
- `force_path: true` → no warning in either case.

### `force_path` schema

New optional boolean field on `RemoteDependency` and `SourceDependency`. Defaults to `false`. Serialized in `skilltree.yml` but NOT in `skilltree.lock` (warnings are authoring-time, not install-path).

## Error Handling

### R9 — direct dep with missing path

| Scenario | Behavior |
|----------|----------|
| Origin declares name, same-repo `local:` | Path inferred, no error, no warning |
| Origin declares name, same-repo `repo:` | Path inferred, no error, no warning |
| Origin declares name, different `repo:` | Fall through; if convention probe fails → error |
| Origin doesn't declare name, convention probe hits | Path inferred (matches today's transitive behavior), no error |
| Origin doesn't declare name, convention probe misses | Clear error with list of checked locations |
| Origin `skilltree.yml` missing, convention probe misses | Clear error |
| Origin declares name only in `dev-dependencies` | Fall through to convention probe; if still missing → error that names the dev-dep location |

Example error (R9 all tiers failed):

```
Error: "task-builder" (from github.com/org/repo) has no path, and the resolver
  could not infer one from:
    - origin's skilltree.yml dependencies (github.com/org/repo)
    - conventional paths in github.com/org/repo

  Fix: add `path:` to your skilltree.yml entry, or have origin declare
       "task-builder" under `dependencies:` in its skilltree.yml.
```

### R10 — warnings

Redundant:
```
Warning: `task-builder` declares path "skills/source/task-builder", which is the
  same path origin's skilltree.yml declares for this name (file://...).
  You can omit `path:` — it will be inferred.
```

Override:
```
Warning: `task-builder` declares path "skills/alt/task-builder", but origin's
  skilltree.yml declares this name at "skills/source/task-builder" (file://...).
  If this override is intentional, set `force_path: true` to silence this warning.
```

## Testing Checklist

### v1.x (already shipped)

- [x] All R1–R8 tests from v1.1 (transitive resolution, cross-repo, constraint conflict, dev-dep rejection, absolute local-path skip, multi-level chains).

### R9 — direct deps, missing path

- [ ] Happy path: direct dep `{repo, version}` (no path), origin's manifest has `local:` entry → path inferred correctly, install succeeds.
- [ ] `source:` alias, no path, origin declares name → inferred.
- [ ] Origin declares name with same-repo `repo:` → inferred.
- [ ] Origin declares name with different `repo:` → fall through, convention probe, works if conventional, errors otherwise.
- [ ] Origin declares name with `local:` absolute path → fall through, convention probe.
- [ ] Origin doesn't declare name, convention probe hits → inferred.
- [ ] Origin doesn't declare name, convention probe misses → error naming all checked locations.
- [ ] Origin `skilltree.yml` missing → convention probe.
- [ ] Origin `skilltree.yml` malformed → convention probe.
- [ ] Origin declares name only in `dev-dependencies` → fall through; convention probe or error.
- [ ] Aliased YAML key (`name:` differs from key) → lookup uses actual name, not key.
- [ ] Agent direct dep, no path, origin declares agent → inferred with `type: agent`.
- [ ] Multiple direct deps from same origin, path omitted for all → all inferred, single manifest read (optional perf check via fetch count).

### R10 — warnings

- [ ] Consumer `path:` matches origin's `local:` → redundant warning emitted.
- [ ] Consumer `path:` matches origin's same-repo `repo:` path → redundant warning emitted.
- [ ] Consumer `path:` differs from origin's path → override warning emitted (names both paths).
- [ ] Origin doesn't declare name → no warning.
- [ ] Origin declares name in `dev-dependencies` only → no warning (dev-deps invisible to consumers).
- [ ] `force_path: true` + matching path → no warning.
- [ ] `force_path: true` + overriding path → no warning.
- [ ] `force_path: true` + origin doesn't declare name → no warning, no error (field tolerated).

### R13 — `skilltree add` ergonomics

- [ ] `skilltree add foo --repo <url>` (no `--path`) writes entry without `path:` when origin manifest resolves it.
- [ ] `skilltree add foo --repo <url>` (no `--path`) + origin doesn't declare → writes entry without `path:`, install later fails with R9 error if convention probe also misses.

### Side-quest — existing `source:` / `path:` gap tests

Audit before writing tests; add any missing:

- [ ] Undefined `source:` alias → error at expand time (existing behavior).
- [ ] Explicit `path:` that doesn't exist at the resolved tag → existing `not found at path` error.
- [ ] `source:` that expands to a URL but `path:` missing and origin doesn't help → R9 error path.

## Open Questions

None. Decisions locked:
- Warning on override (Option A) + `force_path: true` opt-out.
- Spec renamed to reflect broader scope.
- CLI `--path` optional.

## Future Work

- **Origin-manifest-driven `name:` inference for aliases.** Not motivated.
- **Transitive lockfile provenance.** `skilltree deps tree` should annotate origin-manifest-sourced deps.
- **`skilltree validate` for origin authors.** Lint origin's own `skilltree.yml` for broken paths / dev-deps transitively exposed / cross-repo constraints.
- **`skilltree explain <dep>`.** Show every constraint on a dep and who placed it (post-R7 useful for debugging deep chains).
