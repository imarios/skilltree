# Carbon Phase 2 — Retrospective

## What went well

- The tier-2 (manifest-as-index) and tier-3 (cross-filtered dynamic scan) implementations landed in roughly the right shape on the first pass. Spec PS12–PS14 mapped cleanly to code paths.
- Reading the manifest once and reusing it for both tier 2 (emit) and tier 3 (filter) avoided a duplicate git read.
- The hidden-path helper exported from `registry-scanner` lets `index-cmd` reuse the exact same predicate, which is the whole point of the visibility predicate.
- `SCANNER_VERSION` bump is the right propagation mechanism — consumers' caches auto-invalidate.

## What was harder than expected

- The DETAILED_PLAN initially proposed dropping the tier-3 cross-filter as unnecessary, but on re-reading spec PS13 the cross-filter is the load-bearing piece for repos where the maintainer has a real `skilltree.yml` and conventional-layout SKILL.md files coexist. Reverted to spec-compliant behavior mid-phase. **Lesson:** don't simplify spec requirements until you've walked through every consumer's worldview.
- `dependency type assignment from manifest` was loose — the `Dependency` union doesn't expose `type` as a property of `LocalDependency` (it lives on the type itself). Worked around via a permissive cast in `inferEntityType`.

## Learnings carried into next phases

- The hidden-path concept is the load-bearing primitive across Phases 2, 3, 4. Vendor (Phase 3) will reuse `hiddenPathsFromManifest` directly. Origin-manifest lookup (Phase 4) can use the same `isPubliclyVisible` predicate.
- The "tier 2 emits at least one entry → use it; else fall through" rule depends on real visible entries being present. Worth a `skilltree check` warning later if the maintainer has a manifest with zero local entries but conventional-layout skills on disk — they probably want to declare them.

## Plan adjustments

None. Phase 3 (installer + vendor) is next.
