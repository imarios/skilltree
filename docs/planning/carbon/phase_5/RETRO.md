# Carbon Phase 5 — Retrospective

## What went well

- The `lintAsymmetricPublish` function is pure (`entities → string[]`), which made unit-testing the graph walk trivial. 10 cases covered direct, transitive, multi-chain, clean, all-publish-false, remote-edges, dev-group, render-format, and cycle-safety in one file.
- BFS with a `Set<string>` for visited published nodes naturally handles cycles. Terminating chains at `publish: false` leaves cycle-detection trivial.
- Chain rendering with indented arrows reads well at a glance. The "← blocks downstream consumers" marker on the leak is the visual anchor.

## What was harder than expected

- **The "one warning per leaking root" question.** Initial expectation was 1 warning per asymmetric chain, but the lint produces one warning per *exposed published entity that can reach a publish:false*. For a 2-hop chain, that's 2 (root + intermediate). Briefly considered deduping, but the additional warnings carry useful info — fixing the leaf clears all of them. Updated test, kept the behavior.
- **Catch-up tests.** Adding a new top-level command broke (a) the help snapshot, (b) the completion freshness test, (c) the commands.md skill freshness. Caught in CI-style by `bun test`; each required a small targeted update. **Lesson:** adding a CLI command is never a single-file change.

## Learnings carried to project completion

- Three doc surfaces need updating in lockstep when commands change: `cli.ts`, `src/commands/completion.ts`, and `skills/skilltree/references/commands.md`. Existing freshness tests catch drift — good.
- The publication-surface README section (PS32) reads cleanly because Phase 1-5's design was coherent. Writing it last (after everything works) avoided rewriting it through the project.

## Plan adjustments

None. All 5 phases complete. Ready for project completion + PR.
