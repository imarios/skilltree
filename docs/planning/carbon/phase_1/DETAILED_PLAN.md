# Carbon Phase 1 — Detailed Plan

Spec: [publication_surface.md](../../../specs/publication_surface.md) §PS1–PS5, PS27–PS28

## Scope

Foundation only. Add the two new optional fields to the schema, validate them, build the visibility-predicate helper. **No use sites are wired up** — Phase 1 ships dead helpers that get activated in Phases 2–5.

## Files touched

| File | Change |
|---|---|
| `src/types.ts` | Add `publish?: boolean` and `exclude?: string[]` to `LocalDependency`. |
| `src/core/manifest.ts` | Extend `validateManifest`: reject `publish:` / `exclude:` on remote (`repo:`/`source:`) entries; type-check both fields. |
| `src/core/visibility.ts` | **NEW**. `isPubliclyVisible(entry, group)` helper — single source of truth for PS1 predicate. |
| `tests/core/visibility.test.ts` | **NEW**. Parametrized predicate table. |
| `tests/core/manifest-publish-exclude.test.ts` | **NEW**. Round-trip, validation errors, type-check edge cases. |

## Design decisions

- **Fields live on `LocalDependency` only.** Putting them on the union type and validating away from remote is uglier than just adding them where they're allowed.
- **Validation, not parse-time rejection.** Parser remains permissive (`as Record<string, Dependency>` style); `validateManifest` catches the "field on wrong variant" case. Mirrors how `force_path` works today.
- **Predicate signature.** `isPubliclyVisible(entry: Dependency, group: "dependencies" | "dev-dependencies"): boolean`. Returns `false` if group is `dev-dependencies` OR `entry.publish === false`. Defaults: `publish` omitted → treated as `true`.
- **Predicate does not accept just the entry.** It needs the group to enforce PS1 ("in `dependencies` AND publish !== false"). Callers always know which group they're walking.
- **No frontmatter visibility yet.** Spec deliberately stays in the manifest (PS3 wording: "on a manifest entry"). SKILL.md frontmatter could carry `publish: false` later; not in scope.

## Security pre-review

- `publish: false` is **not** access control. It's an authoring signal. Anyone with git access to the repo can read every file regardless of the flag. Document this in spec/README (PS32 covers).
- `.skilltreeignore` (Phase 3) parses untrusted glob patterns; reuse a maintained gitignore matcher rather than rolling our own to avoid ReDoS surface. (Defer to Phase 3.)
- Phase 1 itself adds no auth boundaries, no I/O, no external surface. P0 security review for this phase is N/A.

## Phase-specific DoD

- All current tests pass (`bun test`).
- New tests pass.
- `tsc` clean.
- biome lint/format clean.
- No use site changed — registry scanner, installer, vendor, graph all remain on existing behavior.
