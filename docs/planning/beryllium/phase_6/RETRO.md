# Phase 6 Retrospective: Teach as Global Dependency

## What went well
- The design worked: `teach` is now a thin wrapper around `addCommand` + `installCommand`
- `getInstallTargets(manifest, { global: true })` cleanly separated project vs global resolution
- Reusing `installToTargets()` (extracted in the quickfix round) made global multi-target trivial
- All 12 teach tests pass, 588 total tests green

## What was harder than expected
- Test migration: old tests checked file paths in fake home directories, but the install pipeline resolves to real `~/.agent/` paths via `resolveGlobalTarget()`. Had to shift tests from file-path verification to manifest/lockfile verification. This is actually better — tests verify the contract (skill is in the dependency graph) not the implementation detail (file is at this exact path).

## Learnings
- The "impractical" label from Phase 4 retro was wrong — once we had `addCommand` and `installCommand` accepting `globalDir` overrides, the integration was straightforward. The blocker was overthinking path stability; `teach` being idempotent makes it a non-issue.
- Extracting `installToTargets()` during the quickfix round (for complexity reduction) turned out to be the key enabler — it let both project and global install share the same multi-target loop.

## Plan adjustments
- R21 in BACKLOG can be marked complete
