# Origin-Manifest Transitive Resolution

+++
version = "1.0"
date = "2026-04-18"
status = "active"

[[changelog]]
version = "1.0"
date = "2026-04-18"
summary = "Initial spec — origin-manifest lookup for transitive deps (local: entries)."
+++

## Problem Statement

Transitive dependency resolution today only finds a dep inside the parent entity's repo when the repo follows a specific directory convention (`skills/<name>/SKILL.md`, `agents/<name>.md`, or `<name>/SKILL.md` at repo root). Repos that organize skills differently — e.g., nesting under `skills/source/<name>/` — cannot be auto-resolved transitively. Consumers must re-declare every transitive dependency in their own `skilltree.yaml`, defeating the point of transitive resolution.

Concrete failure: a consumer declares `task-builder` (pulled remotely from a repo with a nested layout). `task-builder`'s frontmatter lists `hypothesis-building-task` as a dep. The origin repo stores that skill at `skills/source/hypothesis-building-task/`, so the same-repo probe misses it. Install fails; the consumer must manually declare `hypothesis-building-task` against a path they shouldn't need to know about.

## Goals & Non-Goals

### Goals

- Skill authors can control where their skills live. If they ship a `skilltree.yaml`, that manifest becomes the authoritative name-to-location map for transitive resolution.
- Repos that already work (convention-based layout) keep working with no change.
- A failed transitive lookup produces an actionable error that names every place the resolver checked.

### Non-Goals

- Exposing origin's `dev-dependencies` to downstream consumers (see R4).
- Changing the resolver's behavior for **direct** dependencies — only transitive resolution is affected.
- Full cross-repo transitive resolution via origin's manifest (entries in origin that use `repo:`/`source:` to point at third-party repos). See Future Work.

## Requirements

- **R1**: When a transitive dep cannot be found in the consumer's manifest, the already-resolved context, or the parent's local source, the resolver MUST consult the origin repo's `skilltree.yaml` (read at the parent's pinned git ref) before falling back to the conventional path probe.
- **R2**: If the origin manifest declares the dep name under `dependencies:` with a `local:` entry, the resolver MUST synthesize a same-repo remote dep (`{repo: parentRepo, path: stripDotSlash(local)}`) pinned to the parent's resolved tag and resolve it.
- **R3**: If the origin manifest is missing, unreadable, or malformed, the resolver MUST silently fall through to the conventional probe. Missing/broken origin manifests are never themselves fatal.
- **R4**: The resolver MUST NOT expose `dev-dependencies` declared in the origin manifest. If the transitive dep is only present in origin's `dev-dependencies`, resolution fails with an informative error (R5).
- **R5**: When all lookup tiers fail, the error message MUST enumerate every location the resolver checked (consumer manifest, resolution context, origin manifest dependencies, conventional paths). If the dep was present in origin's `dev-dependencies`, the error MUST include a specific hint pointing at the upstream author.
- **R6**: The convention-based same-repo probe (`skills/<name>`, `agents/<name>.md`, `<name>`) MUST still run after the origin-manifest lookup, preserving zero-config behavior for repos without a `skilltree.yaml`.
- **R7**: Cross-repo entries (`repo:`/`source:`-expanded-to-`repo:`) in the origin's manifest MUST fall through to the conventional probe. They are explicitly deferred; see Future Work.

## Constraints

### Resolution order (transitive)

After this spec ships, `resolveTransitive()` checks:

1. Already-resolved context
2. Consumer manifest (either group)
3. Local-source probe (if parent is a local dep)
4. **Origin-manifest lookup (new)** — parent's origin `skilltree.yaml`, `dependencies` only
5. Same-repo conventional probe (`skills/<name>/SKILL.md`, `agents/<name>.md`, `<name>/SKILL.md`)
6. Error

### Synthesized dependency shape

| Origin entry (in `dependencies:`) | Synthesized dep |
|-----------------------------------|-----------------|
| `local: ./path/in/repo` | `{repo: parentRepo, path: stripDotSlash(local), type?, name?}` pinned to parent's tag. |
| `repo:` / `source:` → `repo:` | Falls through to conventional probe (deferred, see Future Work). |

### Versioning

- `local:` entries in origin resolve at the **parent's resolved tag**, consistent with "one repo = one version" (spec `decisions.md` §1). No separate version constraint from the origin manifest applies.
- The consumer's own `skilltree.yaml` is never mutated. Transitive resolution writes only to the in-memory resolution context and the lockfile.

## Error Handling

| Scenario | Behavior | User Impact |
|----------|----------|-------------|
| Origin `skilltree.yaml` missing | Silent fall-through to conventional probe | Indistinguishable from today's behavior |
| Origin `skilltree.yaml` malformed | Silent fall-through | No crash; final error (if any) reflects convention miss |
| Origin declares dep under `dependencies` with `local:` | Resolved from origin's path, pinned to parent's tag | Auto-resolved; no consumer action needed |
| Origin declares dep under `dev-dependencies` only | Fall-through → error with dev-dep hint | Error names the upstream author as the fix site |
| Origin declares dep with `repo:` (cross-repo) | Fall-through → convention probe → error | Deferred; consumer must declare explicitly |
| Name not declared anywhere in origin | Fall-through to convention probe | Standard behavior |

Example error (all tiers failed, no dev-dep hint):

```
task-builder (from github.com/org/repo) declares dependency "hypothesis-building-task",
     not found in:
       - your skilltree.yaml
       - already-resolved dependencies
       - origin's skilltree.yaml dependencies (github.com/org/repo)
       - conventional paths in github.com/org/repo

     Fix: skilltree add hypothesis-building-task --repo <repo-url> --path <path>
```

Example error (dev-dep hint):

```
     Note: "foo" is declared as a dev-dependency in origin's manifest (github.com/org/repo).
     dev-dependencies are not exposed to downstream consumers.
     Fix: upstream should move it to `dependencies`, or declare foo explicitly in your own skilltree.yaml.
```

## Testing Checklist

- [x] Happy path: origin declares dep as `local: ./skills/source/<name>`, consumer transitively resolves it; lockfile records the synthesized remote dep at the parent's tag.
- [x] Multi-level chain: consumer declares one entity; two transitive deps both auto-resolve via origin manifest; all three share the origin tag.
- [x] Fall-through: no `skilltree.yaml` in origin → conventional probe still works.
- [x] Fall-through: origin manifest present but doesn't declare the name → conventional probe runs.
- [x] Fall-through: origin manifest is malformed YAML → no crash, conventional probe runs.
- [x] Dev-dep rejection: origin declares name only in `dev-dependencies` → error includes the dev-dep hint.
- [ ] Cross-repo via origin manifest (`repo:` entry) — deferred to Future Work.
- [ ] `source:` alias via origin manifest — deferred to Future Work.

## Open Questions

None.

## Future Work

- **Cross-repo transitive via origin manifest (R7 follow-up).** Support `repo:` and `source:` entries in origin's `dependencies:`. Requires on-demand repo resolution (cloning a previously-unseen repo during transitive lookup) and constraint intersection with any pre-existing resolution for that repo. Currently these entries fall through to the conventional probe and then to an error.
- **Origin-manifest lookup for direct deps.** Consumers could drop `path:` from their own entries and have it resolved from origin's manifest. Not yet motivated — direct deps generally know their own path.
