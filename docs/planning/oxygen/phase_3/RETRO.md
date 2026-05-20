# Phase 3 — Retrospective

## What went well

- **`remove.ts` needed zero changes.** The DETAILED_PLAN's prediction held: the generic manifest-mutation path already handles `PackDependency` because it treats the deps map as opaque. The two `tests/commands/remove-pack.test.ts` cases became regression guards rather than red→green driver tests.
- **`canonicalSource`'s Phase 1 work paid off again.** `checkOverwrite` reuses it untouched; only the *message* needed to learn about packs.
- **Local short-circuit's try/catch fallback** — wrapping `loadManifestOrThrow` so the missing-manifest case falls through to registry resolution kept the path safe in test scenarios that don't run `init` first.
- **The registry surface (`IndexEntry.kind`) is fully backward-compatible.** Old caches without `kind` still work; entries default to entity behavior. New pack entries serialize cleanly.

## What surprised us

- **Help snapshot + completion test failures came as a single batch.** The CLI flag addition propagated to three different test mechanisms (help-snapshot, bash completion, zsh completion). Updating `completion.ts` plus regenerating the snapshot covered all three. Good signal that those tests are doing their job.
- **`isPackDependency` import order tripped biome formatter** — adding the new import landed inside the existing `import type { ... }` block, which biome moved into its own line. Minor.
- **`buildPackDep` is sufficient without an `--pack <name>` rename test of its own** — the test that asserts `yaml-key="my-stack"` + `pack:"python-pack"` after a CLI rename covers the rename path end-to-end.

## What to carry into Phase 4

- The e2e test path uses `createTestRepo` + `file://` URLs in the same fashion as the resolver tests. Phase 4 should reuse the H1/J2 patterns from `tests/core/graph-packs.test.ts` for the e2e fixture.
- Docs cross-references should mention: `packs:` shape (spec.md), pack-ref dep shape (reference.md), the `bundle` reserved-word decision (decisions.md), `IndexEntry.kind` (registries.md), pack publication semantics (publication_surface.md — confirm: packs themselves have no publish/exclude; members keep their own).

## What to NOT carry forward

- **Don't add a CLI test for `--pack` glob mode.** Phase 3 explicitly deferred glob mode for packs. The existing glob-mode code path errors with `--repo/--source/--local/--path` — `--pack` would naturally land in the same family. A test row to confirm this is fine but not blocking.

## Process notes

- 16 new tests + 4 source file edits + 1 cli wiring change shipped in under one cycle. The DETAILED_PLAN.md predicted the exact change set; no mid-implementation surprises.
- LightningMode is still going strong — three full FlashMode phases shipped in one session with full TDD, hardening, retro, single commit per phase. No corner cuts.
