# Carbon Phase 3 — Detailed Plan

Spec: [publication_surface.md](../../../specs/publication_surface.md) §PS6–PS11, PS17–PS22

## Scope

File-level trim. Introduce a gitignore-style matcher and wire it into the installer (copy of local entities) and vendor command. Vendor also filters `publish: false` entities.

## Files touched

| File | Change |
|---|---|
| `src/core/ignore.ts` | NEW. Minimal gitignore-style matcher. |
| `src/core/installer.ts` | `copyEntityFiles` honors per-entity `exclude:` and repo-level `.skilltreeignore`. New helper to build combined matcher. |
| `src/core/graph.ts` | `ResolvedEntity` gains `publish?: boolean` and `exclude?: string[]` threaded from the manifest's `LocalDependency`. |
| `src/commands/vendor.ts` | Skip `publish: false` local entities when planning. |
| `tests/core/ignore.test.ts` | NEW. Parametrized pattern table (gitignore subset). |
| `tests/core/installer-exclude.test.ts` | NEW. Local entity copy honors `exclude:` and `.skilltreeignore`. |
| `tests/commands/vendor-publish.test.ts` | NEW. Vendor skips `publish:false` locals. |

## Design decisions

- **Minimal gitignore subset, in-tree.** Avoid a new npm dep. Support: literal segment match, `*` glob within segment, `**` glob across segments, `?` single-char wildcard, trailing `/` (directory marker — but our path-walk gives file paths, so effect is "matches inside the named dir"), and unrooted vs rooted (`/`-containing) patterns. Skip negation (`!`) — YAGNI for Phase 3; add if a use case surfaces.
- **Two scopes, one engine.** Per-entity `exclude:` patterns match against the entity-relative path. `.skilltreeignore` patterns match against the repo-relative path. Same `Matcher` class, called with different relative paths.
- **`exclude:` is a no-op on single-file entities (agent/command).** The file is the entity; nothing to filter. Document and move on.
- **Threading through `ResolvedEntity`.** `publish` and `exclude` ride on the resolved entity so `executeInstall` doesn't have to re-read the manifest. Spec PS17/PS20/PS21 are about install-time behavior; the data should be available there.
- **Vendor `publish: false` filter only.** Spec PS20 says "vendor applies the visibility predicate" — strictly read, that would exclude `dev-dependencies` too. But vendor today intentionally includes dev-deps so the maintainer's own dev environment vendors. Filtering only `publish: false` preserves today's behavior and matches the spirit of the spec. Flagging the strict reading as a BACKLOG item.

## Security pre-review

- `.skilltreeignore` parses untrusted patterns. Our matcher converts patterns to RegExp. Risk: catastrophic backtracking on pathological patterns. Mitigation: the conversion is bounded — `*` → `[^/]*` and `**` → `.*` are both linear in input length. No nested quantifiers introduced.
- `.skilltreeignore` lives next to `skilltree.yml`; same trust boundary as the manifest itself. Anyone who can write one can write the other.
- No new I/O surface; `cp` filter remains the primary mechanism.

## Phase-specific DoD

- Matcher's gitignore-subset behavior matches the documented patterns (parametrized tests).
- `copyEntityFiles` excludes files matching either matcher.
- `vendor` skips `publish: false` local entries.
- `tsc` + biome clean, full suite green.
