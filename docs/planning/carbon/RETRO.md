# Carbon — Project Retrospective

Started: 2026-05-14
Completed: 2026-05-14 (same-session FlashMode across all 5 phases)
Resolves: issue #63

## Spec coverage (PS1–PS32)

Every requirement from `docs/specs/publication_surface.md` is satisfied. Traceability:

| Req | Coverage |
|---|---|
| PS1–PS2 | Phase 1 — `isPubliclyVisible` in `src/core/visibility.ts` |
| PS3–PS5 | Phase 1 — `LocalDependency.publish` + installer keeps publish:false locally installed |
| PS6–PS8 | Phase 1 (field) + Phase 3 (semantics) — `exclude:` validated as local-only, entity-relative |
| PS9–PS11 | Phase 3 — `IgnoreMatcher`, `.skilltreeignore` at repo root, layered with `exclude:` |
| PS12–PS14 | Phase 2 — fallback chain in `scanRegistry`, `registry index` filters publish:false + dev-deps |
| PS15–PS16 | Phase 4 — origin-manifest lookup detects publish:false, tailored error message |
| PS17–PS19 | Phase 3 — installer honors exclude/.skilltreeignore on local copy; publish:false installs locally |
| PS20–PS22 | Phase 3 — vendor filters publish:false locals (dev-deps preserved per existing contract) |
| PS23–PS26 | Phase 5 — `skilltree check` lint with `--strict`, chain rendering |
| PS27–PS28 | Phase 1 — validateManifest rejects publish/exclude on remote entries + type-checks |
| PS29 | Phase 2 — `docs/specs/registries.md` "Indexing fallback chain" subsection |
| PS30 | Phase 5 — `docs/specs/spec.md` "Dependencies: Remote vs Local" extended |
| PS31 | Phase 4 — `docs/specs/reference.md` origin-manifest section |
| PS32 | Phase 5 — `README.md` "Publication Surface" subsection |

All 32 spec requirements covered. No deferred items.

## Open questions from the spec

Three items flagged in `publication_surface.md` "Open Questions":

1. **Naming (`publish: false` vs alternatives).** Shipped as `publish: false`. No friction during implementation; the word reads correctly in every consumer-facing message. **Resolution:** keep `publish: false`. Close the question.
2. **`exclude:` glob flavor.** Implemented as gitignore-subset (literal, `*`, `**`, `**/`, `?`, root anchor, dir-trailing-slash; negation deliberately deferred). Parametrized test table covers the contract. **Resolution:** gitignore-subset, documented in `src/core/ignore.ts` JSDoc.
3. **Vendor includes dev-dependencies?** Today's vendor copies both groups (vendor.ts line 75 comment). Phase 3 preserved that and only filters `publish: false`. Strict spec PS20 reading ("applies the visibility predicate") would also drop dev-deps. **Unresolved.** This is a sir-decides question. Added to BACKLOG.

## What went well

- **Spec-first paid off.** Writing `publication_surface.md` with 32 numbered requirements before any code, then mapping each phase's tasks to req IDs, made FlashMode's autonomous execution low-risk. No major scope drift across 5 phases.
- **Phase 1 as foundation.** Shipping the schema + visibility predicate as dead helpers in Phase 1 — with no use sites — gave every later phase a single integration point. No mid-project refactor of the predicate signature.
- **Reusing existing patterns.** `originDevDepHints` → `originHiddenHints` is a 10-line widening, not a parallel system. `hiddenPathsFromManifest` is the same predicate-as-set pattern reused across registry-scanner, index-cmd, and vendor.
- **TDD red→green per phase.** Tests caught the `?` glob-replacement-order bug, the test fixture path that let conventional-probe rescue the dev-dep case, and the "publish:false reaches the wrong path" issues. No production debugging.

## What was harder than expected

- **JSDoc + glob characters.** Initial `ignore.ts` JSDoc used `**` and `*/` patterns inside backticks; TypeScript's parser mis-tokenized. Worked around by rewording the docblock.
- **Biome's control-char regex rule.** First implementation used `\x00`/`\x01` as glob-translation placeholders; biome rejected them. Switched to Unicode non-characters (`\u{1FFFE}`, `\u{1FFFF}`).
- **Test fixtures at conventional paths.** Phase 4's first-draft tests put fixtures at `skills/<name>`, which let the resolver's convention probe rescue resolution and made the new lookup path untestable. Moving fixtures to `skills/source/<name>` exercises the manifest tier exclusively.
- **CLI command additions are never single-file.** Adding `skilltree check` broke (a) the help snapshot, (b) the completion freshness test, (c) `commands.md` skill coverage. All three caught by existing freshness tests — good — but the catch-up work added latency.

## What I'd do differently next time

- **Cap the scope of Phase 1's foundation more tightly.** Phase 1 shipped two fields + one predicate + validation. Could split into "schema + parse" (Phase 1a) and "validation + predicate" (Phase 1b) for even cleaner commits. Not a big deal here but useful for larger features.
- **Stand up the lint command before the constraint code.** Phase 5 was last because the lint can't exist until the predicate is in place. But a stub `skilltree check` in Phase 1 (printing "no lints yet") would have made the CLI-side touchpoints (help snapshot, completion, commands.md) churn once instead of at the end.

## Stats

- 6 commits on `feature/carbon-publication-surface`:
  - 1 skeleton (PROJECTS, spec, PLAN)
  - 5 phase commits (one per phase)
- ~75 new tests (visibility, manifest validation, ignore matcher, registry-scanner fallback, index-cmd, installer exclude, vendor publish, graph downstream, check lint)
- 1198 total tests, all green
- 1 new top-level command (`skilltree check`)
- 1 new core module (`core/visibility.ts`, `core/ignore.ts`)
- Spec coverage: 32/32 requirements

## Carbon — final status

✅ All 5 phases complete. Ready for PR.
