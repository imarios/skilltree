# Phase 3 — Short Memory

## Stubs to implement

- [x] `src/core/git.ts`: `canonicalRepo`; `normalizeGitUrl` strips trailing slashes before `.git`
- [x] `src/core/graph.ts`: `resolutionKey` normalizes; raw-repo `repoResolutions`/`repoConstraints` sites switched; `RepoResolution.repo` keeps the spelled URL for cloning and messages; `entry.repo === consumerRepo` (×2) and frozen inheritance via `canonicalRepo`; conflict Fix + capped warning text; `resolutionAttempted` replaces `frozenAttempted`
- [x] `src/core/lockfile.ts`: `classifyDep` repo compare
- [x] `src/commands/outdated.ts`: `constraintsByRepo` keys
- [x] `src/commands/update.ts`: selective same-repo clearing
- [x] `src/core/deps.ts`: `canonicalSource` for repo deps (and pack refs' repo)
- [x] docs: decisions.md, reference.md, spec.md, README.md, skills/skilltree/references/commands.md
- [ ] PROJECTS.md (at the end)

## Tests written (red → green)

- [x] CR1–CR3
- [x] RS1–RS3, plus RS4 (conflict reported once)
- [x] RC1–RC4
- [x] MS1 (error-attribution snapshot rerun; wording change only in the Fix line)

## Found during the phase

- `normalizeGitUrl` removed `.git` before trailing slashes, so `…/repo.git/` and `…/repo.git` normalized differently — separate cache clones, and (with this phase) separate resolutions. CR3 caught it.
- Pre-existing: a version conflict was reported twice, because `resolveRepoVersions` runs again after pack expansion and only successful resolutions short-circuited. Same flaw as the frozen duplicate in Phase 1; one `resolutionAttempted` set now covers both. RS4 guards it (confirmed red with a one-off debug run before the fix).
- `canonicalSource` now returns canonical repo URLs, so `deps.test.ts`'s sentinel test compares against `canonicalRepo("source:unknown")`; the non-collision assertion is unchanged.

## Notes

- Raw-repo sites at plan time (graph.ts): 244/250 grouping, 380 `resolveOneRepo` set, 440 tagless set, 501 pack get, 1263/1371 `entry.repo === consumerRepo`, 1403 lazy get; plus `resolveOneRepo`'s `has(repo)` and the lazy tail `has(repo)`.
- Clone URL stays the user's spelling; only keys normalize.
- `normalizeGitUrl` on `file:///tmp/x.git` → `file:///tmp/x` (the `:(?=[^/])` rule skips `file:/`), so local fixtures normalize sanely.
