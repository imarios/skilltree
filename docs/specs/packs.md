# Packs — Named Groups of Dependencies

+++
version = "1.0"
date = "2026-05-19"
status = "draft"

[[changelog]]
version = "1.0"
date = "2026-05-19"
summary = "Initial spec — local + remote packs, full-entry members, all-or-nothing v1, nested packs deferred."
+++

## Problem Statement

Teams that share a common toolkit (e.g. a "Python stack": `python-coding` + `fast-api` + `pytest-testing`) copy-paste the same dep list across every `skilltree.yml`. Drift sets in: one project upgrades a member, another doesn't, and a fix to the canonical list has to be applied N times. There is currently no way to declare "I want these N skills together as a unit."

## Goals & Non-Goals

### Goals
- A consumer declares **one** dep entry and gets N member skills/agents/commands installed.
- Pack definitions can live **locally** (in the consumer's own `skilltree.yml`) or **remotely** (in any git repo's `skilltree.yml`), via one mechanism.
- Pack members may be drawn from **multiple repos** (full dep entries, not bare names).
- Remote packs are **versioned by git tag** of the containing repo (same model as skills).
- Zero impact on the installer, lockfile schema, scanner, vendor, and doctor.
- Door left open for **nested packs** (pack-in-pack) in a future version with no breaking change.

### Non-Goals
- **No per-member overrides** at the consumer side (no `exclude:`, no version override). All-or-nothing in v1.
- **No nested packs** in v1 — a pack member may not itself be a pack.
- **No new file type** — packs live in `skilltree.yml`, not a separate `PACK.md`.
- **No pack entity in the lockfile** — only expanded members.
- **No glob expansion for `skilltree add 'foo-*'`** — entities only.

## Requirements

- **R1**: A `skilltree.yml` may declare a top-level `packs:` mapping whose keys are pack names and whose values are non-empty lists of full dep entries (each with `repo`/`source`/`local`, optional `path`/`version`/`name`/`force_path`/`type`).
- **R2**: A consumer references a pack by adding a `PackDependency` entry to `dependencies:` or `dev-dependencies:` of shape `{ pack: <name> [, repo|source: ..., version: ...] }`.
- **R3**: A pack reference with no `repo:`/`source:` is a **local pack reference** — `<name>` must resolve in the consumer's own `packs:` section, else error.
- **R4**: A pack reference with `repo:` (or `source:` expanded to a repo) is a **remote pack reference** — the resolver reads `packs:` from the remote manifest at the resolved git ref, looks up `<name>`, and expands its members.
- **R5**: Pack expansion runs as a **discrete phase** of the resolver between repo-version resolution and entity-graph processing. After expansion, the dep map contains only entity deps; the rest of the resolver runs unchanged.
- **R6**: A pack member is **never registered as an entity itself**. Only its expanded members become entries in `state.entities` and the lockfile.
- **R7**: A pack member that collides with a consumer-declared dep, or with a member from another pack, must produce a resolver error naming both sides. No silent merge.
- **R8**: A pack name must not collide with a non-pack `dependencies.<name>` entry in the same manifest — caught at parse-time.
- **R9**: A `PackDependency` may not carry `path`, `type`, `name`, `force_path`, or `local`. A `PackDependency` with `version:` must also have `repo:` or `source:`.
- **R10**: `skilltree add <name>` produces a `PackDependency` when (a) `--pack` is set, (b) `packs.<name>` exists locally and no source flags are given, or (c) a registry entry matches with `kind: "pack"`.
- **R11**: A `BUNDLE.md`-style file is **NOT** introduced. Packs live in `skilltree.yml` only.
- **R12**: Global manifests (`~/.skilltree/global.yml`) may **reference** remote packs but may **not define** packs.

## Data Model

### `PackDependency` (consumer's `dependencies:`)
| Field      | Type     | Required | Notes |
|------------|----------|----------|-------|
| `pack`     | string   | Yes      | Name of the pack being referenced. |
| `repo`     | string   | No       | Remote pack — repo URL containing the `packs:` section. |
| `source`   | string   | No       | Remote pack via source alias (expands to `repo` at parse time). |
| `version`  | string   | No       | Semver constraint on the containing repo's git tag. Requires `repo`/`source`. |

Mutually exclusive: `repo` ⊕ `source` ⊕ (neither → local pack reference).

### `PacksSection` (top-level `packs:`)
```ts
type PackMember = RemoteDependency | SourceDependency | LocalDependency;
type PacksSection = Record<string, PackMember[]>;  // name → non-empty member list
```

Members are full dep entries with the same shape as direct `dependencies:` entries (same validation, same source expansion). A `pack:` field on a member is rejected in v1.

### Example

```yaml
# acme/skill-packs/skilltree.yml — the defining repo
packs:
  python-pack:
    - repo: github.com/acme/python-skills
      path: python-coding
      version: ^1.0.0
    - repo: github.com/acme/python-skills
      path: fast-api
    - source: tiangolo
      path: pytest-testing

# consumer's skilltree.yml
dependencies:
  python-pack:
    repo: github.com/acme/skill-packs
    pack: python-pack
    version: ^2.0.0

# consumer-local pack
packs:
  my-stack:
    - repo: github.com/acme/skills
      path: skill-a
    - local: ./local-skills/skill-b

dependencies:
  my-stack:
    pack: my-stack
```

## Constraints

- **No new file type.** Packs are a `skilltree.yml` section; this keeps the manifest the single source of truth.
- **Installer/lockfile schema unchanged.** Packs are purely a resolver-input transformation.
- **Resolver remains correct under existing two-phase model.** Pack expansion is a new Phase 1.5; `processDeps` sees only entity deps.
- **`bundle` is reserved** — the term is already used internally for the embedded skilltree skill (`src/core/bundled-skill.ts`). Do not reuse it for this feature.

## Error Handling

| Scenario | Behavior | User Impact |
|---|---|---|
| Local pack referenced but undefined | Resolver error names the pack and the manifest key. | `Pack "X" is referenced under dependencies.X but not defined in this manifest's packs: section.` |
| Remote manifest missing `packs:` section / missing pack | Resolver error names repo + ref + pack. | `Pack "X" not found in <repo>@<ref> (expected under packs: in skilltree.yml).` |
| Pack member collides with consumer-declared dep | Resolver error names both. | `Member "Y" of pack "X" collides with consumer-declared dep "Y" — to override a pack member, remove it from the pack and declare it directly.` |
| Two packs share a member | Same collision error. | Same. |
| `packs.X` defined + non-pack `dependencies.X` | Parse-time error. | Names both and suggests `pack: X` or rename. |
| `PackDependency` with `path`/`type`/`name`/`local`/`force_path` | Parse-time error. | Names the field and explains why it doesn't apply. |
| `PackDependency` with `version` but no `repo`/`source` | Parse-time error. | `version: is only valid on remote pack references.` |
| Pack member with absolute `local:` path in a **remote** pack | Resolver error. | Mirrors the existing `isRelativeLocalPath` check. |
| Local pack defined but never referenced | Non-blocking warning. | `Warning: pack "X" defined in packs: is never referenced.` |
| Nested pack (`pack:` field on a member) | Parse-time error. | `Nested packs are not supported in this version.` (Forward-compat hook.) |

## Testing Checklist

- [ ] Parse: empty list, single remote member, mixed remote+local, `source:` member expansion, nested-`pack:` rejection, non-mapping `packs:`, member missing both `repo`/`local`.
- [ ] Validate: `PackDependency` mutex (`repo`+`source`), with `path`/`local`/`type`, with `version` but no repo/source; `packs.X` vs non-pack `dependencies.X` collision; global manifest with `packs:`.
- [ ] Resolve (local): 3-member pack expands to 3 entities, pack not in entities; mixed local+remote members; undefined local pack errors; collision with consumer dep errors; collision between two packs errors; `dev-dependencies` ref puts members in dev; member with `name:` alias.
- [ ] Resolve (remote): containing repo resolved in Phase 1; members in different repos resolved in Phase 1.5b; missing `packs:` / missing pack errors; absolute `local:` member rejected; `declaredIn` shapes correct (consumer for local, transitive for remote).
- [ ] `add`: local short-circuit when `packs.X` exists; `--pack --repo` writes full pack ref; `--pack --path` rejected; registry-resolved pack (kind=pack); `--pack --dev` writes to `dev-dependencies`; overwrite of pack ref preserves no fields (asserted for future-proofing).
- [ ] `remove`: `isPackDependency` guard prevents entity-resolution; pack ref removed cleanly.
- [ ] Lockfile: a manifest with a pack ref produces a lockfile containing only the expanded members.
- [ ] E2E: `init → add pack → install → verify files exist` for both local and remote packs.

## Open Questions

None blocking v1 — all resolved during planning (see "Confirmed design decisions" in `docs/planning/oxygen/PLAN.md`).

## Future Work

- **Nested packs** (pack-in-pack) — design preserved in v1; lift the parse-time block and wrap `expandPackReferences` in a convergence loop with a visited-set for cycle detection.
- **Consumer-side overrides** (`exclude:` member list, per-member version pin) — defer until real demand surfaces.
- **`skilltree why <pack>`** — a follow-up. v1 only supports `why <member>` which reports `_viaPack` provenance.
- **Glob mode for `skilltree add 'X-pack-*'`** — defer.
- **Lockfile `pack_resolutions:` section** — only if reproducibility of *which pack version was used* becomes a need.
