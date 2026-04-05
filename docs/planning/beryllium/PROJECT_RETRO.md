# Project Retrospective — Beryllium (Multi-Agent Support)

Date: 2026-04-04

## What worked well

- **Phase 1 foundation investment**: Building the data layer (agent registry, target resolution, manifest types) before touching any commands meant Phases 2-4 were small diffs on top of a solid base. Phase 3 (the scariest change — multi-target install) was ~30 lines in install.ts because `getInstallTargets()` handled all the complexity.

- **TDD discipline**: Every phase had tests written before implementation. Tests passed on first try across all 5 phases. The existing test suite (519 tests at start) caught every regression immediately — especially the completion and skill freshness tests that enforce CLI/docs sync.

- **Backward compatibility by design**: `getInstallTargets()` falling back to `[getDevInstallPath()]` meant 570 existing tests passed without modification when the multi-target loop was added. Zero breaking changes for existing users.

- **Error messages written during implementation, not after**: Phase 5's error review found nothing to fix — every error path already had actionable guidance because it was written alongside the code.

- **Spec-driven development**: Having a spec (multi-agent.md) with numbered requirements made verification systematic. The completion review caught 4 gaps that would have been missed otherwise.

## What didn't work well

- **Planning docs skipped for Phases 4 and 5**: Despite the methodology being explicit about this, the pace of LightningMode led to cutting corners on DETAILED_PLAN, TEST_PLAN, SHORT_MEMORY, and RETRO for two phases. Had to retroactively create them. The docs were weaker because the thinking had already happened — they documented decisions rather than driving them.

- **3 requirements left unimplemented without explicit acknowledgment**: R10a (stale target detection), R17-R18 (global --global flag), and R19 (vendor guard) were quietly deferred during implementation without updating the spec or creating BACKLOG entries. The project completion review caught them, but they should have been flagged during the phase where the decision was made.

- **Spec design didn't survive contact with implementation (R21)**: "Teach as global dep" was specified as R21 but turned out to be impractical (bundled skill source isn't in a git repo). The pragmatic decision to keep direct copy was correct, but the spec wasn't updated to reflect this until retroactively.

## Late discoveries that should have been caught earlier

- **Completion and freshness tests require manual config updates**: Adding the `targets` command required updating 3 separate places (completion.ts COMMANDS array, commands.md, SUBCOMMAND_PARENTS test map). This is fragile — a future improvement would be to auto-generate completions from commander definitions.

- **`dev_install_path` was used by `init` and `vendor` in ways that needed updating**: The ripple effect of replacing `dev_install_path` with `install_targets` wasn't fully mapped during planning. Vendor still uses `getDevInstallPath()` and ignores `install_targets` — this should have been caught in Phase 3 planning.

## Process improvements for future projects

1. **Flag deferrals explicitly during the phase, not at project completion**: When a requirement is deferred during implementation, immediately add it to BACKLOG.md and note it in SHORT_MEMORY.md. Don't wait for project completion to discover the gaps.

2. **Planning docs are non-negotiable in LightningMode**: Add a checklist at the start of each phase: "DETAILED_PLAN exists? TEST_PLAN exists? SHORT_MEMORY exists?" Don't write code until all three are created.

3. **Map ripple effects during Phase 1 planning**: When introducing a new field that replaces an existing one (like `install_targets` replacing `dev_install_path`), grep for all usages of the old field and list them in the detailed plan. This prevents surprises in later phases.

## Methodology feedback

- **LightningMode tempo is good but needs guardrails**: The speed of LightningMode is valuable — 5 phases in one session. But the methodology should make the planning docs a hard gate, not a should. Consider: FlashMode refuses to proceed to Cycle 040 (tests) unless Cycle 030 docs exist.

- **Project completion is essential**: The spec verification step caught 4 unimplemented requirements. Without it, the project would have been "done" with silent gaps. This step should be emphasized more in the methodology overview — it's not just bureaucracy, it's where the real quality check happens.

- **Phase retros were useful even when brief**: The pattern of "went well / harder than expected / learnings / plan adjustments" consistently surfaced useful information. The Phase 1 retro caught the `silent` option anti-pattern. The Phase 4 retro documented the teach-as-global-dep design decision. Worth keeping.
