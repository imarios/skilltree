# Phase 4 Retrospective: Teach Auto-Detection + Init

## What went well
- Agent detection logic from Phase 1 (`detectInstalledAgents`) worked perfectly here
- All 6 new tests passed first try
- Existing teach/init tests caught the signature changes immediately

## What was harder than expected
- The teach-as-global-dep approach (spec R18) turned out to be impractical: the bundled skill source isn't in a git repo, and the global manifest mechanism expects repo or local paths. Decided to keep the direct copy approach but make it agent-aware. This is a pragmatic tradeoff documented in the detailed plan.
- Updating existing tests for the new API was mechanical but required attention — 4 teach tests and 4 init tests needed new `homeDir` params.

## Learnings
- When a spec design turns out to be impractical during implementation, document the decision and move on rather than force-fitting. The "teach as global dep" can be revisited later when the global manifest supports bundled skills.
- The `homeDir` test override pattern (used in agents.ts, teach.ts, init.ts) is consistent and testable. Good pattern to keep.

## Plan adjustments
- Deferred "teach as global dep" to future work — documented in spec as a future improvement
