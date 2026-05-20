# Publication Surface

+++
version = "1.0"
date = "2026-05-14"
status = "active"

[[changelog]]
version = "1.0"
date = "2026-05-14"
summary = "Initial spec — unified publication surface for skill repos: skilltree.yml as registry-index fallback, publish:false WIP flag, exclude/.skilltreeignore file trim, unified visibility predicate, asymmetric-publish lint."
+++

## Problem Statement

A skill repo today has no single, coherent way to declare what it makes available to others. Three related pain points keep recurring:

1. **Two manifests of truth.** `skilltree.yml` lists local entities (name, type, path). `skilltree-index.yml` lists the same information again for search. Maintainers must keep them in sync, or drift produces stale-index errors (see issue #62).
2. **No WIP signal for local entities.** A maintainer iterating on a new skill has no way to say "this exists in my repo, install it locally, but don't surface it via search/vendor/transitive resolution yet." Moving it to `dev-dependencies` would overload existing semantics — those aren't the same concept.
3. **No file-level trim.** Skills are directories. During development they accumulate experiment outputs, A/B test artifacts, scratch notes. There's no way to say "publish this skill, but exclude `experiments/` when consumers install or vendor it."

These look like three problems but they're facets of one question: **what does this repo make available to others?**

This spec defines one cohesive answer governed by a single visibility predicate, with three layered mechanisms (entity-level publish flag, file-level exclude rules, registry-index fallback) and one lint that catches internal inconsistency.

## Goals & Non-Goals

### Goals

- One mental model: `skilltree.yml` describes this repo's published surface.
- Reduce the surface area maintainers must keep in sync (`skilltree-index.yml` becomes optional rather than the default path).
- Give maintainers an explicit way to mark a local entity as not-yet-ready-to-share that doesn't overload `dev-dependencies`.
- Give maintainers an explicit way to trim noise files from published entities (experiments, scratch, large fixtures).
- Apply one visibility rule across every consumer-facing code path (indexing, vendor, origin-manifest lookup).
- Detect and warn about asymmetric publish state (published entity transitively depends on a `publish:false` entity) before consumers hit it.

### Non-Goals

- Replacing `skilltree-index.yml` entirely. Repos that want a curated, hand-maintained public catalog distinct from `skilltree.yml` keep that option.
- Changing the semantics of `dev-dependencies`. Its existing meaning ("needed for this repo's own dev work, not exposed via origin-manifest lookup") is preserved.
- Inferring `publish: false` from filesystem patterns or git state. Maintainer declares it explicitly on the manifest entry.
- A separate registry "private skills" mechanism. `publish: false` is the local-entry signal; remote skills in `dependencies` are inherently public (someone else's choice).
- A replacement glob engine. Reuse `.gitignore`-style semantics.

## Requirements

Requirements are numbered for traceability between this spec and the phase plan (`docs/planning/carbon/PLAN.md`). Format: **PSx** = Publication-Surface requirement x.

### Visibility predicate

- **PS1.** Define a single visibility predicate used by every consumer-facing code path:
  > An entity is **publicly visible** iff it is in `dependencies` (not `dev-dependencies`) **and** `publish !== false`.
- **PS2.** The predicate is implemented as one helper in `src/core/visibility.ts` (or equivalent) and called from every relevant site. No site-local reimplementations.

### `publish:` field

- **PS3.** Add an optional `publish?: boolean` field on a manifest entry. Default: `true`.
- **PS4.** `publish:` is only valid on entries with `local:`. Setting it on a remote (`repo:` or `source:`) entry is a manifest validation error.
- **PS5.** A `publish: false` entry still installs into the maintainer's own `.claude/` (it remains a normal `dependencies` entry for local resolution). The flag only affects consumer-facing visibility.

### `exclude:` field

- **PS6.** Add an optional `exclude?: string[]` field on a manifest entry. Each entry is a `.gitignore`-style glob.
- **PS7.** `exclude:` is only valid on entries with `local:`. Setting it on a remote entry is a manifest validation error.
- **PS8.** `exclude:` patterns are relative to the **entity root**. `experiments/` on a `local: ./skills/python-coding` entry means `./skills/python-coding/experiments/`.

### `.skilltreeignore` file

- **PS9.** Optional `.skilltreeignore` file at the repo root. `.gitignore`-style globs.
- **PS10.** Patterns are relative to the **repo root** and apply to every published entity.
- **PS11.** Layering: per-entity `exclude:` AND `.skilltreeignore` both apply. A file is excluded if it matches either.

### Registry-indexing fallback chain

- **PS12.** `skilltree registry update` resolves entities for indexing via this fallback chain, stopping at the first hit:
  1. `skilltree-index.yml` (curated; explicit list — authoritative override).
  2. `skilltree.yml` `dependencies` local entries (inferred from the manifest).
  3. Dynamic `git ls-tree` scan (existing behavior, unchanged).
- **PS13.** Tier 2 (manifest-derived) only surfaces entries with `local:` set, and only those passing the visibility predicate (PS1). Remote dependencies in `skilltree.yml` are ignored for indexing — they're not this repo's to publish.
- **PS14.** `skilltree registry index` (generation) also filters by the visibility predicate when emitting `skilltree-index.yml`. A `publish: false` entry never appears in a generated index.

### Origin-manifest lookup integration

- **PS15.** Extend origin-manifest lookup (see `origin_manifest_resolution.md`) so a downstream chain hitting a `publish: false` entry produces the same actionable "not exposed to downstream consumers" error already used for `dev-dependencies`. The hint map (`originDevDepHints` or an analog) carries both reasons.
- **PS16.** The error message distinguishes the two reasons (in `dev-dependencies` vs `publish: false`) so the fix is obvious to the downstream consumer reading the message.

### Installer

- **PS17.** When the installer copies a local entity into `.claude/`, it applies both `exclude:` (entity-relative) and `.skilltreeignore` (repo-relative) to filter the file set.
- **PS18.** The installer never copies a `publish: false` entity to a consumer's `.claude/` (consumer install). The maintainer's own install (where the manifest is their own) still copies, because PS5: the maintainer needs to dogfood the WIP.
- **PS19.** Distinction in PS18 is determined by whether the local entry being installed belongs to *the manifest being processed* (maintainer self-install) vs. resolved transitively from another repo (consumer install). In practice: transitive resolution will never reach `publish: false` (PS15 blocks it), so PS18 is automatically satisfied by PS15. Implementation note rather than a separate enforcement point.

### Vendor

- **PS20.** `skilltree vendor` applies the visibility predicate when selecting entities to copy. `publish: false` entities are excluded from the vendored set.
- **PS21.** `skilltree vendor` applies both `exclude:` and `.skilltreeignore` when copying files for each published entity.
- **PS22.** `skilltree unvendor` is unaffected by this spec (it reverses what vendor wrote; nothing to filter).

### `check` lint — asymmetric publish state

- **PS23.** `skilltree check` walks the dependency graph rooted at each entity with `publish !== false` in the local manifest. For each such root, if any reachable same-repo entity has `publish: false`, emit a warning.
- **PS24.** The warning surfaces the full chain (`A → B → C (publish: false)`) so the maintainer can see whether to publish the dep or break the link.
- **PS25.** "Same-repo" means another `local:` entry in the same `skilltree.yml`. Cross-repo deps (remote) are out of scope for this lint — those are governed by origin-manifest lookup (PS15).
- **PS26.** The lint runs as part of `skilltree check`'s existing pass. Exit code: warning (non-zero only if the user opts into strict mode, consistent with other check warnings).

### Validation

- **PS27.** `validateManifest` rejects `publish:` or `exclude:` on remote entries (`repo:` or `source:` without local resolution to a filesystem path). Error message points the user to the correct usage.
- **PS28.** `publish:` accepts only boolean. `exclude:` accepts only a list of strings. Type errors are caught at parse time with clear messages.

### Documentation

- **PS29.** `docs/specs/registries.md` documents the registry-index fallback chain (PS12–PS14) and links to this spec.
- **PS30.** `docs/specs/spec.md` references the `publish:` field and visibility predicate in the manifest section; a short example is added to the "Local Entities" subsection.
- **PS31.** `docs/specs/reference.md` adds `publish` and `exclude` to the dependency-fields reference table with applicability constraints (local-only).
- **PS32.** `README.md` adds a short section explaining the publication-surface concept and the `publish: false` / `exclude:` mechanics. Audience: skill authors, not consumers.

## Open Questions

- **Naming.** `publish: false` is the recommendation. Final sanity check before locking in. Alternatives considered: `private: true`, `draft: true`, `unlisted: true`. See issue #63 discussion.
- **`exclude:` glob flavor.** Gitignore semantics are the default. Confirm during Phase 3 implementation.
- **Vendor audit.** Worth checking whether `vendor` today includes `dev-dependencies` local entries. If it does, this work also fixes that asymmetry (extension of PS20).

## Out of scope / future work

- Per-file conditional publishing (e.g., "include this file only if env X"). Use git branches or separate skills instead.
- Encrypted/private registries with auth. Different concern; `publish: false` is about repo-author intent, not access control.
- Auto-promotion (e.g., "publish after N green CI runs"). Maintainer makes the call explicitly.

## Packs (Oxygen)

Packs have **no publish/exclude semantics of their own** — they are manifest-side groupings, not entities. The publication state of each pack member is governed by the member's own dep entry per the rules above. A pack itself is never published or vendored; the registry-indexing tier 2 emits one `kind: "pack"` entry per `packs:` definition so the pack is discoverable via `skilltree search`, but the visibility predicate (`publish`/`exclude`/dev-status) is not applicable to a pack since it has no entity surface.

If a maintainer wants to hide a pack from registry discovery, they should not define it in `packs:` (or move it to a separate non-indexed repo). There is no per-pack `publish: false`.

## Related

- Issue #63 — design discussion that produced this spec.
- Issue #62 — `skilltree-index.yml` staleness on non-standard layouts; PS12 (fallback chain) addresses the root cause.
- `docs/specs/registries.md` — registry mechanics; gets the fallback chain documented.
- `docs/specs/origin_manifest_resolution.md` — downstream visibility logic that PS15 extends.
- `docs/specs/vendor.md` — vendor mechanics that PS20–PS22 modify.
