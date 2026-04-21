# Phase 4 Detailed Plan — Documentation + Real-World Verification

**Spec ref:** [origin_manifest_resolution.md](../../../specs/origin_manifest_resolution.md) (all)

## Goal

Propagate the v2.0 feature into user-facing docs and verify end-to-end against a real repo.

## Files Touched

| File | Change |
|------|--------|
| `docs/specs/reference.md` | Document R9 direct-dep inference tier and R10 warning semantics. |
| `docs/specs/spec.md` | Rename "Transitive Resolution" section to cover origin-manifest resolution broadly; add R9 example. |
| `README.md` | Extend the "Transitive Dependencies & Lockfile" section with R9 + R10 hints. |
| `skills/skilltree/SKILL.md` | New section: "Origin-Manifest Resolution — Concepts Every Author and Consumer Should Know". Covers what a repo's `skilltree.yaml` promises to consumers, what authors take on as a public contract, and how fall-through works when the manifest is absent/malformed. |

## Verification

- Rebuild binary (`bun run build`).
- Point at `~/Projects/backendv2-y` as a consumer repo with `path:` omitted on the sole direct dep.
- Assert: all 5 skills (1 direct + 4 transitive) install without consumer declaring any paths.
- Assert: adding a consumer `path:` that matches origin fires a redundancy warning; no warnings otherwise.

## Phase-specific DoD

- All docs changes landed.
- Real-world verification clean (0 errors).
- Full test suite remains green.

## Discovered during Phase 4 (false-positive fix)

Initial real-world run showed warnings firing for origin's own transitive entries (`cy-language-programming`, `task-naming`, `hypothesis-building-task`). Root cause: `resolveRemoteEntity` was checking for redundancy on every path-bearing dep, including those synthesized during transitive tiers from origin's own manifest. Fix: thread `fromConsumerManifest: boolean` through `resolveEntity` → `resolveRemoteEntity`. Only top-level (consumer-declared) direct deps trigger R10 warnings. Matches user intent ("warn when *I* provided a redundant path").
