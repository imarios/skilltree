# Carbon Phase 3 — Test Plan

## tests/core/ignore.test.ts

Parametrized table of pattern × path → expected:
- Literal segment match (with and without trailing slash)
- `*` glob within segment (`*.scratch.md`)
- `**/` zero+ dirs (matches at root + nested)
- `**` across segments
- `?` single-char wildcard (doesn't cross /)
- Slash-containing pattern is anchored
- Leading-slash root anchor
- Multi-pattern union
- Comments and blanks skipped
- isEmpty when no real patterns

## tests/core/installer-exclude.test.ts

- Per-entity exclude drops dir contents
- Per-entity glob matches anywhere in entity tree
- .skilltreeignore at repo root applies to local entities
- Layered: exclude + .skilltreeignore — union
- No matchers → today's behavior preserved

## tests/commands/vendor-publish.test.ts

- vendor skips publish:false locals
- vendor keeps dev-dependencies (preserves today's behavior)
- vendor honors per-entity exclude during copy
