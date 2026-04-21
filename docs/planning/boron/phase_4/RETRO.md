# Phase 4 Retrospective

## What went well

- End-to-end verification against `backendv2-y` was immediate and informative — uncovered the synthesized-dep false-positive in under 30 seconds.
- `skills/skilltree/SKILL.md` update turned into a teachable explainer, which is actually what the skill is for. Worth keeping this "author vs. consumer" framing as a lens for future docs.

## Harder than expected

- The false-positive in warning detection. Symptom: 3 extra warnings during the real-world test. Cause: `resolveRemoteEntity` was fired on every dep (including origin's transitives), not just consumer-declared ones. Fix threaded a boolean through `resolveEntity` → `resolveRemoteEntity`. Cleanly isolated — one parameter, one call site, one test run confirmed.
- Good that the real-world verification happened before finalizing — unit tests alone wouldn't have caught this because every R10 unit test uses consumer-declared paths.

## Learnings

- **Real-world runs belong in every phase's DoD for features that cross the codebase.** Unit tests verified R10 correctness for consumer input; the integration run verified that the rest of the resolver respected that scope.
- **"Synthetic vs. user-authored" is a distinction that keeps showing up** in the resolver. Transitive entries look like direct deps but aren't. Future work touching warnings/validation should default to "don't apply unless the input came from the user's hand."

## Plan adjustments

- None. Boron is complete.
