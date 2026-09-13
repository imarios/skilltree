# Phase 3 — Retro

## What went well

- The canonical-identity pattern (CLAUDE.md #1) fit exactly: one `canonicalRepo`, and `resolutionKey` already sat in front of most resolver lookups from Phase 1, so normalizing there covered frozen and unfrozen resolutions at once.
- The parametrized spelling table (pattern #4) found a real bug on its first run: `normalizeGitUrl` stripped `.git` before trailing slashes, so `…/repo.git/` had its own cache clone.
- Docs landed in the same phase as the code they describe; the skill-freshness tests (README and bundled `commands.md` must list every CLI command) caught that the new commands weren't documented yet.

## What was harder than planned

- **Clone URL vs key.** Grouping by canonical repo meant the map key could no longer double as the clone URL (`git@host:x/y` would have become `https://host/x/y`). `repoConstraints` now carries the first spelled URL, and `RepoResolution.repo` keeps it for cloning and messages.
- **Duplicate conflict errors**, pre-existing: the resolver's second pass (pack expansion) re-reported any repo that had failed. Diagnosed with a one-off debug test before fixing; one `resolutionAttempted` set now covers repos and frozen tags.
- **Full-suite timing.** FR9 (two freezes plus an install) passed alone but hit bun's 5s default under full-suite load; given an explicit 30s timeout.

## Decisions made during the phase

- Keys normalize, clone URLs don't: the user's spelling is always what gets cloned.
- `canonicalSource` returns canonical repo URLs, so `add`'s "changing source" warning ignores respellings; its sentinel test compares against `canonicalRepo`.
- Conflict and capped messages recommend `skilltree freeze` instead of splitting repos.

## Carry forward

- `cache clean` or a re-clone (URL drift, corrupt cache) drops preserved `refs/skilltree/frozen/*` refs; a fresh machine gets the documented "Frozen tag not found" error when the tag is gone upstream.
- Test pollution of the real `~/.skilltree/cache` (`CACHE_DIR` via `os.homedir()` at load) is filed as a separate task.
