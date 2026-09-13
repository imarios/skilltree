# Phase 3 — Repo-key normalization + docs

## Why this phase exists

The #203 workaround spelled one repo two ways (`github.com/elastic/agent-skills` and `…agent-skills.git`) so the resolver treated them as different repos and resolved each independently. The cache path already normalizes (`repoCachePath` → `normalizeGitUrl`), so both spellings shared one clone but got two resolutions. With `freeze` available, that loophole should close: one repo, one shared resolution, and a conflict that used to be dodged by respelling now points at `freeze`.

## Security pre-review

- Normalization only affects map keys and comparisons. Clone URLs are unchanged: `ensureCached` still receives a URL the user wrote, so no transport is rewritten (an `ssh` spelling is never turned into `https`).
- Two spellings of one repo that differ in transport (`git@host:x/y` vs `https://host/x/y`) share a key. They already share a cache directory today, so this adds no new cross-talk.

## Design

### `canonicalRepo(repo)` — `src/core/git.ts`

`normalizeGitUrl(repo)`. One function name for "do these two repo strings name the same repo?", per CLAUDE.md hardening pattern #1. Parametrized test table of equivalent spellings (pattern #4).

### Resolver (`src/core/graph.ts`)

- `resolutionKey(repo, frozen)` returns `canonicalRepo(repo)` (plus the frozen suffix), so every existing key-based lookup normalizes in one place.
- Replace the remaining raw-repo map operations with `resolutionKey(repo, undefined)`: `resolveRepoVersions` grouping, `resolveOneRepo` has/set, `addTaglessRepoResolution` set, pack-expansion get, `ensureRepoResolvedLazy` get/has/origin get.
- Grouping keeps the first declared URL for cloning; constraints from every spelling join one intersection.
- Same-repo comparisons use `canonicalRepo`: origin-manifest path inference (`entry.repo === consumerRepo`, two sites) and `resolveOriginRemoteEntry`'s frozen inheritance.

### Everything else that compares repos

- `src/core/lockfile.ts` `classifyDep`: `canonicalRepo(dep.repo) !== canonicalRepo(locked.repo)` — respelling a URL isn't a change.
- `src/commands/outdated.ts`: `constraintsByRepo` keyed and looked up by `canonicalRepo`.
- `src/commands/update.ts` selective update: same-repo clearing via `canonicalRepo`.
- `src/core/deps.ts` `canonicalSource`: return `canonicalRepo(dep.repo)` / `canonicalRepo(resolved)` for remote deps, so `add`'s "changing source" warning ignores respellings.

### Messages

- Version conflict error `Fix:` line: replace "or move entities to separate repos" with "or freeze the deps that need an older tag: skilltree freeze <name> <tag>".
- #119 capped warning: replace "or split the dep across repos to upgrade the rest" with "or freeze it (skilltree freeze <name> <tag>) so it stops capping the rest".
- Update any snapshot that pins those strings.

### Docs

- `docs/specs/decisions.md` #1: one repo = one version still holds; `frozen:` is the explicit exception; respelling a repo URL no longer creates a separate resolution.
- `docs/specs/reference.md`: `frozen` in the manifest dependency fields; `frozen` in the lockfile field table; new errors (frozen tag not found, non-exact `frozen`, `frozen` + `version`) and warnings (tag deleted / moved upstream); preserved ref under Phase 2 Version Resolution.
- `docs/specs/spec.md`: Versioning section mentions freezing; `freeze` / `unfreeze` under Commands.
- `README.md`: command table rows for `freeze` / `unfreeze`; `-n`/`-g` flag rows list them.
- `skills/skilltree/references/commands.md`: `freeze` / `unfreeze` sections; note under `update` and `outdated`.
- `docs/PROJECTS.md`: move Neon to Completed at the end.

## Tasks (TDD order)

- [ ] T1 `canonicalRepo` parametrized tests (red) → helper (green)
- [ ] T2 resolver test: two spellings of one repo now share one resolution, and the old workaround produces the capped warning (red) → resolver keys (green)
- [ ] T3 conflict across spellings → one error whose Fix mentions `skilltree freeze` (red) → message
- [ ] T4 `classifyDep`, `outdated`, selective `update`, `canonicalSource` respelling tests (red) → changes
- [ ] T5 docs
- [ ] T6 harden: tsc, biome, full suite, manual smoke against a real tagged repo; RETRO; PROJECTS.md
