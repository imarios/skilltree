# Phase 3 Retrospective: Multi-Target Install

## What went well
- The `getInstallTargets()` fallback made this fully backward-compatible — 570 existing tests passed without changes
- Only 3 of 5 new tests failed (red), 2 already passed because single-target worked out of the box
- The loop approach was clean: resolve once, install N times
- Lockfile `install_targets` field added with zero lockfile.ts code changes (YAML handles it)

## What was harder than expected
- Nothing — the Phase 1 foundation (getInstallTargets, resolveTarget) did the heavy lifting

## Learnings
- Building the data layer first (Phase 1) paid off — Phase 3 was a small diff in install.ts

## Plan adjustments
- Deferred global install targets, stale target detection, and vendor multi-target to Phase 5 (polish)
- These are edge cases that don't block the core multi-target workflow
