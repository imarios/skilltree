# Oxygen — Project Retrospective

**Duration:** 05/19/2026 (single-day arc; LightningMode)
**Phases:** 4
**Commits:** 4 (one per phase)
**Tests added:** 86 (1472 → 1558 in the full suite)

## Spec verification

Walked `docs/specs/packs.md` requirements R1–R12. Every requirement is covered by tests or assertions:

| Req | Covered by |
|---|---|
| R1 (packs: declaration) | Phase 1 Group A parse tests + Phase 4 e2e |
| R2 (PackDependency shape) | Phase 1 Group B + D + G + Phase 3 add-pack tests |
| R3 (local pack ref) | Phase 2 I1; Phase 4 e2e local-pack case |
| R4 (remote pack ref) | Phase 2 J1, J2; Phase 4 e2e remote-pack case |
| R5 (Phase 1.5 expansion) | Phase 2 H1, H4; Phase 4 e2e |
| R6 (pack not registered as entity) | Phase 2 H1 (entity absence assert); Phase 4 lockfile assert |
| R7 (member collision errors) | Phase 2 I2, I3 |
| R8 (parse-time pack vs dep collision) | Phase 1 D3 |
| R9 (PackDependency forbidden fields) | Phase 1 D1 (parametrized) |
| R10 (add three paths) | Phase 3 add-pack tests (local short-circuit, --pack, registry kind=pack) |
| R11 (no PACK.md file type) | Implicit — no file created; spec confirms |
| R12 (global manifest may not define packs) | Phase 1 E1 |

All edge cases from the spec testing checklist (parse, validate, resolve local, resolve remote, add, remove, lockfile, e2e) are green.

## What worked

- **The original 4-phase split held.** Phase 1 (types + manifest) → Phase 2 (resolver) → Phase 3 (CLI) → Phase 4 (docs + e2e) gave clean, reviewable PRs and predictable mid-flight checkpoints. No phase was re-scoped during execution.
- **DETAILED_PLAN.md per phase eliminated design pauses.** Each phase's implementation was mechanical TDD red→green. Zero implementation churn from "wait, how should this work?" mid-edit.
- **Pack-as-manifest-side-only** was the load-bearing design decision. It made Phase 2's resolver work touch one file (`graph.ts`), Phase 3's add work touch four files, and Phase 4's docs work straightforward. The installer, lockfile schema, scanner, vendor, and doctor never learned about packs.
- **`canonicalSource` reuse from Phase 1** paid off twice: in Phase 2 for collision detection logic, in Phase 3 for `add`'s overwrite messaging.
- **Idempotent `resolveRepoVersions` + Phase 1.5b second pass** elegantly handled the "remote pack's members live in a different repo" case without per-repo bookkeeping.
- **Type-soundness fallout from guard-tightening** (Phase 1) surfaced three pre-existing latent bugs in `info.ts` and `registry-scanner.ts`. The compiler caught them; we fixed them in the same PR.

## What was harder than expected

- **Biome cognitive-complexity limit** on `canonicalSource` (Phase 1) was a borderline trigger. Extract-helper fix was the right move but added a function. Worth keeping the threshold; the warning catches real complexity creep.
- **`Dependency & { local: string }` intersection narrowing** (Phase 1) needed a parameter-type change to `LocalDependency` directly. Subtle TS quirk worth knowing for future helpers.
- **`Dependency.version`** field doesn't exist on `LocalDependency` (Phase 2) — split the access into a per-shape branch. Small refactor.

## Deferred work (logged to BACKLOG.md)

- Nested packs (pack-in-pack) — v2.
- `skilltree why <pack-member>` provenance via `viaPack`.
- `skilltree why <pack>` shape design.
- Consumer-side pack overrides (`exclude:`, per-member version pin).
- `skilltree add 'pack-*'` glob mode.
- Lockfile `pack_resolutions:` section (only if reproducibility-of-pack-version need surfaces).
- Manual smoke against a real GitHub pack repo (post-merge).

## Process notes

- LightningMode held the full TDD + harden + retro + commit discipline across all 4 phases. No corner cuts. Speed came from removing handoff delays, not from skipping steps.
- The auto-generated CHANGELOG (commitizen-driven) means the four `feat(packs):` commits will produce a clean release block automatically on the next `cz bump`.
- Single feature branch (`feat/oxygen-phase-1-pack-types-manifest`) carried all four commits. Per sir's existing convention, each phase commits and the user decides when to push and open PRs.

## Counts

- **Production code touched:** 7 files (`types.ts`, `manifest.ts`, `graph.ts`, `deps.ts`, `add.ts`, `registry-scanner.ts`, `cli.ts`, `completion.ts`, `info.ts`).
- **Tests added:** 86 across 8 new test files + 1 snapshot regeneration.
- **Docs added/changed:** spec.md, reference.md, decisions.md, registries.md, publication_surface.md, packs.md (new spec), README.md, BACKLOG.md, PROJECTS.md + 12 planning files.
- **Commits:** 4 (one per phase, conventional `feat(packs):` messages).
- **Final test count:** 1558/1558 green.
- **Final tsc:** clean.
- **Final biome:** clean on all changed files.
