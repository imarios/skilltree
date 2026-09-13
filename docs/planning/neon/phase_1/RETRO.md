# Phase 1 — Retro

## What went well

- The cache already reads every file by ref (`git show <ref>:<path>`), so frozen deps needed no second clone, no worktree and no installer change: leaving `tag` unset and letting reads fall back to `commit` covered the tag-gone case for free.
- Keying `repoResolutions` by `resolutionKey(repo, frozen)` kept the change to lookup sites rather than a new resolution structure. Every consumer of a resolution (`resolveRemoteEntity`, both transitive tiers) switched with a one-line key change plus inheritance of `frozen`.
- The #203 fixture (remove + rename between tags) reproduced the real failure exactly (FZ2) before any code changed.

## What was harder than planned

- **Moved tags wiped the cache.** PR3 showed `git fetch --tags` refuses to clobber a moved tag, and `cloneOrFetchBare` treats any fetch error as a corrupt cache: delete and re-clone. That silently discarded the preserved ref. Pre-existing — every moved tag upstream has been costing users a full re-clone. Fixed with `--force` on the first fetch; the second fetch already force-updates tags, so revocation still propagates.
- **Second resolution pass duplicated errors.** `resolveRepoVersions` runs again after pack expansion; a failed frozen lookup left no resolution to short-circuit on. Needed an explicit `frozenAttempted` set.
- **Complexity lint** on `tryResolveFromOriginManifest` after adding frozen inheritance; extracted `resolveOriginRemoteEntry`.

## Decisions made during the phase

- Preserved ref is named by version (`refs/skilltree/frozen/0.4.0`), not tag spelling.
- Moved tag: keep the preserved commit and warn with the `skilltree freeze` fix, rather than silently taking the new commit.
- `frozen:` rejected on pack refs and pack members for v1.
- Stale-tag-manifest warning skips frozen resolutions ("cut a new tag" is no fix for a deliberate old pin).

## Process notes

- The preserved-ref implementation was written before PR1–PR5 ran red. Two of those tests still failed on first run and exposed real bugs, but the order should have been test-first.

## Carry into Phase 2

- Unfreezing by hand doesn't re-resolve: the lockfile doesn't record `frozen`, and the old version satisfies `*`. Either `unfreeze` clears the lockfile entry, or lockfile entries get an additive optional `frozen` field (recommended — covers hand edits too; backward compatible like `via_pack`).
- `freeze <name>` without a tag reads the lockfile version; `freeze` onto a moved tag must overwrite the preserved ref.
