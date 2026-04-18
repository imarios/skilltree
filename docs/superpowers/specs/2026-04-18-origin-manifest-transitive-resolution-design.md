# Origin-Manifest Transitive Resolution

**Date:** 2026-04-18
**Status:** Design

## Problem

Transitive dependency resolution today only finds a dep inside the parent entity's repo when the repo follows a specific directory convention:

```
skills/<name>/SKILL.md
agents/<name>.md
<name>/SKILL.md
```

Repos that organize skills differently -- e.g., `skills/source/<name>/` and `skills/dev/<name>/` as in `analysi-backend` -- cannot be auto-resolved transitively. Consumers must re-declare every transitive dependency in their own `skilltree.yaml`, defeating the point of transitive resolution.

Concrete failure case: a consumer declares `task-builder` (pulled remotely from `analysi-backend`). `task-builder`'s frontmatter lists `hypothesis-building-task` as a dep. `analysi-backend` stores that skill at `skills/source/hypothesis-building-task/`, so the same-repo probe misses it. Install fails. The consumer has to manually add `hypothesis-building-task` to their own manifest, pointing at `skills/source/hypothesis-building-task` -- a path they shouldn't need to know about.

## Goal

Let skill authors control where their skills live by making the origin repo's `skilltree.yaml` the authoritative source of name-to-location mappings for transitive resolution. The existing conventional probe stays as a fallback for repos without a manifest.

## Non-goals

- Changing behavior for repos that already work (convention-based layout).
- Exposing origin's `dev-dependencies` to downstream consumers (see Decision 1).
- Supporting origin manifest lookup for the direct-dependency code path -- this proposal is only about transitive resolution.

## Design

### Resolution order (transitive)

Today: `resolveTransitive()` in `src/core/graph.ts` tries these in order:

1. Already-resolved context
2. Consumer manifest lookup
3. Local-source probe (if parent is local)
4. Same-repo conventional probe (if parent is remote)
5. Error

New behavior: same-repo resolution (step 4) becomes a two-tier lookup:

4a. **Origin-manifest lookup** (new) -- read `skilltree.yaml` at the parent's git ref, look up `dependencies[depName]`. If found, use it.
4b. **Conventional probe** (today's behavior) -- probe `skills/<name>/SKILL.md`, `agents/<name>.md`, `<name>/SKILL.md`.

Manifest is authoritative when present; the probe is the zero-config fallback.

### Origin-manifest lookup semantics

When `tryResolveFromSameRepo` runs and the parent has `repo` set:

1. Attempt `readFileAtRef(cachePath, ref, "skilltree.yaml")`. Silent fall-through to probe on any failure (missing file, parse error, etc.).
2. Parse as a skilltree manifest. Expand `sources:` aliases.
3. Look up `depName` in the parsed manifest's `dependencies` **only**. `dev-dependencies` are not consulted.
4. If found, synthesize a dependency entry and call `resolveEntity(depName, actualName, syntheticDep, parentGroup, state)`:

   | Origin entry type | Synthesized dep |
   |-------------------|-----------------|
   | `local: ./path/to/x` | Remote dep `{repo: parentRepo, path: stripDotSlash(./path/to/x), version: parentVersion}` -- same repo, same tag. |
   | `repo: ...` / `path: ...` / `version: ...` | Use as-is (points at a 3rd-party repo with its own version constraint). |
   | `source: alias` | Expand `alias` via origin's `sources:` map, then treat as `repo:` or `local:`. |

5. If not found, fall through to the conventional probe.

### Versioning rules

- `local:` entry in origin manifest → synthesized as a remote dep pinned to the **parent's resolved tag**. This is consistent with Decision #1 ("one repo = one version").
- `repo:`/`source:` entry in origin manifest → use the origin's declared version constraint (defaults to `*`). The consumer's lockfile records the resolved tag.
- The consumer's own `skilltree.yaml` is unchanged; transitive resolution writes the synthesized entry only to the in-memory resolution context and the lockfile.

### Error message

When both origin-manifest lookup and conventional probe fail, the error should name all four places we checked:

```
task-builder (from github.com/org/repo) declares dependency "hypothesis-building-task",
  not found in:
    - your skilltree.yaml
    - already-resolved dependencies
    - origin's skilltree.yaml dependencies (github.com/org/repo)
    - conventional paths in github.com/org/repo
  Fix: skilltree add hypothesis-building-task --repo <repo-url> --path <path>
```

If the origin's `dev-dependencies` DID declare the name, include a specific hint:

```
    Note: "hypothesis-building-task" is declared as a dev-dependency in origin's manifest.
    dev-dependencies are not exposed to downstream consumers. The upstream author must move it
    to `dependencies`, or you must declare it explicitly in your own manifest.
```

### Decisions

1. **Only `dependencies`, never `dev-dependencies`.** Dev-deps are "not shipped, dev-only" by definition. If an upstream skill transitively depends on something that upstream marks as dev-only, that is a mistake the upstream author should fix -- not a hole the resolver should paper over. Surface a clear error rather than silently promoting the dev-dep.

2. **Manifest-first, convention fallback.** Manifest is authoritative when authors provide one. Convention stays so repos without a manifest keep working.

3. **Silent fall-through on manifest read errors.** A missing or malformed `skilltree.yaml` in the origin is not itself an error; fall through to the probe. This keeps the feature opt-in from the author's side and avoids breaking existing repos that don't have a manifest.

4. **Origin manifest is parsed at the parent's ref, not HEAD.** Consistent with reading SKILL.md frontmatter at the pinned ref -- same-repo deps are same-tag deps.

## Implementation

Two main changes in `src/core/graph.ts`:

1. **New helper:** `tryResolveFromOriginManifest(depName, parentGroup, parentCompositeKey, state) -> Promise<boolean>`. Mirrors `tryResolveFromSameRepo` in shape. Reads `skilltree.yaml` at the parent's ref, parses, expands sources, looks up `dependencies[depName]`, synthesizes an entry, calls `resolveEntity`.

2. **Insert into resolution chain:** In `resolveTransitive`, call the new helper between `tryResolveFromLocalSource` and `tryResolveFromSameRepo`. Order: existing-context → consumer-manifest → local-source-probe → origin-manifest → same-repo-probe → error.

Manifest parsing should reuse existing logic in `src/core/manifest.ts` (including sources expansion) rather than duplicating it. If that logic is currently file-path-oriented, extract a content-oriented variant.

### Error-message upgrade

Rewrite `addUnresolvedError` to enumerate all four search locations. Add the dev-dependencies hint when applicable (needs to know if the origin manifest declared the name under dev-deps -- track this in a state field during the manifest lookup step).

## Testing

Unit tests, all against fixture repos:

1. **Happy path, `local:` entry** -- origin declares `foo: local: ./skills/source/foo`, consumer transitively resolves it. Lockfile records `foo` as a remote dep from origin repo at the parent's tag, with path `skills/source/foo`.
2. **Happy path, `source:` alias** -- origin has `sources: shared: github.com/x/y` and `foo: source: shared, path: skills/foo`; resolves through the alias.
3. **Happy path, cross-repo `repo:` entry** -- origin declares `foo: repo: github.com/third/party`; resolves to third-party repo with its own version.
4. **Dev-dependency rejection** -- origin has `foo` only in `dev-dependencies`; resolution fails with the dev-dep hint.
5. **No `skilltree.yaml` in origin** -- falls through to conventional probe; convention-layout repos keep working (regression guard).
6. **`skilltree.yaml` present but doesn't declare the name** -- falls through to conventional probe.
7. **Malformed `skilltree.yaml` in origin** -- silent fall-through, no crash.
8. **Version inheritance** -- `local:` entry's synthesized dep is pinned to the parent's resolved tag, not `*`.

Integration test: reproduce the `analysi-backend` scenario end-to-end -- consumer declares `task-builder` remotely, transitive `hypothesis-building-task` resolves from origin's `local:` declaration without requiring the consumer to add it.

## Open questions

None. Ready to write the implementation plan.
