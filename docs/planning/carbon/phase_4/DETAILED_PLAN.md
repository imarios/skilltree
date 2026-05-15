# Carbon Phase 4 — Detailed Plan

Spec: [publication_surface.md](../../../specs/publication_surface.md) §PS15–PS16, PS31

## Scope

Extend origin-manifest lookup so a downstream chain hitting an entry that origin marked `publish: false` produces the same actionable "not exposed to downstream consumers" error already used for `dev-dependencies`.

## Files touched

| File | Change |
|---|---|
| `src/core/graph.ts` | Generalize `originDevDepHints` (rename to `originHiddenHints`, value type widened to `{ repo, reason }`). Detect `publish: false` in origin's `dependencies` and record a hint with reason `"publish-false"`. Update `addUnresolvedError` to render distinct messages. |
| `tests/core/graph-publish-downstream.test.ts` | NEW. Downstream resolution fails cleanly when transitive dep is `publish:false`; error text matches and distinguishes from the dev-dep case. |
| `docs/specs/reference.md` | Document the new resolution-failure reason. (PS31) |

## Design decisions

- **Widen the hint map's value type.** `Map<string, { repo: string; reason: "dev-dependency" | "publish-false" }>`. Both reasons share the structure; future reasons can be added without another sibling map.
- **Rename `originDevDepHints` → `originHiddenHints`.** Field is internal (private state on `ResolutionState`); renaming is safe. Reflects the broader concept.
- **Detection point.** In `tryResolveFromOriginManifest`, after fetching `prodEntry`, check `isLocalDependency(prodEntry) && prodEntry.publish === false`. Record the hint and return `false` (same fall-through as the dev-dep case).
- **Order of precedence between reasons.** A name can't appear in both `dependencies` and `dev-dependencies` (validated in manifest). So `publish:false` and `dev-dependency` reasons are mutually exclusive per name.
- **No remote entry handling.** `publish:` is only valid on local entries (Phase 1 validator enforces this). Remote entries in origin's manifest are someone else's concern.

## Security pre-review

- No new I/O surface. No new external inputs.
- Error message includes the origin repo URL — same as today's dev-dep message.

## Phase-specific DoD

- New error message renders for transitive `publish: false` chains.
- Existing dev-dep error message unchanged.
- `tsc` + biome clean, full suite green.
- `docs/specs/reference.md` updated.
