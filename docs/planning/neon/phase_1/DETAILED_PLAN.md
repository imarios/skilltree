# Phase 1 — `frozen:` field + resolver

## Security pre-review

- **Ref-name injection**: the preserved ref is `refs/skilltree/frozen/<tag>`. `<tag>` comes from the upstream tag list (matched against a validated semver string), never raw manifest text. Still run it through `git check-ref-format` semantics: only write refs for tag names that `listTags` returned.
- **Tag revocation (git.ts #55 comment)**: tag pruning exists so a maintainer revoking a malicious tag propagates. A preserved ref deliberately keeps the old commit for a frozen dep. Mitigation: always warn when the preserved commit is used because the tag is gone or moved, naming the commit, so revocation is visible; `unfreeze` / re-`freeze` (Phase 2) drop or move the ref. Documented in decisions.md in Phase 3.
- **No new network or filesystem surface** beyond writes inside the existing bare cache.

## Design

### Manifest

- `frozen?: string` on `RemoteDependency` and `SourceDependency` (passes through `expandSourceDep` via `...rest`).
- Validation in `validateManifest` (new `validateFrozen`):
  - must be a non-empty string that is an exact semver after stripping one leading `v` (`semver.valid`) — ranges, partials (`0.4`), `latest`, numbers → error;
  - mutually exclusive with `version:`;
  - rejected on `local:` deps and on pack references (pack freezing is out of scope for v1);
  - rejected on pack members (members resolve through synthesized deps; out of scope for v1).

### Resolution

- `resolveRepoVersions` skips frozen deps when building `repoConstraints`, so they never enter `resolveIntersection` or the #119 capped warning.
- Frozen deps are resolved by a new `resolveFrozen(repo, frozenTag, state)`:
  1. `ensureCached`, `listTags`; find the tag whose version equals `frozenTag` (accept `v`-prefixed or bare tags).
  2. Read preserved ref `refs/skilltree/frozen/<version>` (named by version so it doesn't depend on a tag spelling that may be gone).
  3. Outcomes:
     - tag present, no preserved ref → commit = tag commit; write preserved ref.
     - tag present, preserved ref equal → use it.
     - tag present, preserved ref differs → use preserved commit; warn "tag X was moved upstream (now <new>); keeping frozen commit <old>. Run `skilltree freeze <name> X` to take the new commit."
     - tag gone, preserved ref present → use preserved commit, `tag` unset (reads go through the commit); warn "tag X no longer exists upstream; using preserved commit <sha>".
     - tag gone, no preserved ref → error naming dep, repo, tag.
- Resolutions are keyed by a resolution key rather than the raw repo: `resolutionKey(repo, frozenTag?)` → `repo` or `` `${repo}#frozen=${version}` ``. `state.repoResolutions` keeps its type; only the key changes.
- `ResolvedEntity` gains `frozen?: string`. Every `state.repoResolutions.get(<repo>)` site switches to `resolutionKey(repo, frozen)`:
  - `resolveRemoteEntity` (dep.frozen)
  - origin-manifest transitive tier and same-repo probe tier (parentEntity.frozen) — a frozen parent's same-repo deps resolve at the frozen ref and the synthesized entity inherits `frozen`
  - pack expansion (never frozen in v1 — plain repo key)
  - `checkStaleTagManifests` iterates all resolutions; unaffected by keying
- Consumer-declared deps keep tier priority (decision #4): a transitive name the consumer declares unfrozen resolves at the shared version, as today.

### Lockfile

- No schema change. `version`/`commit` already recorded. Lockfile consistency check must treat a changed `frozen:` like a changed `version:` so editing the tag re-resolves.
- Lockfile-first install reads `entry.commit`; the preserved ref keeps that commit's objects alive after an upstream tag deletion.

### git.ts additions

- `readRef(cachePath, ref): Promise<string | null>`
- `writeRef(cachePath, ref, commit): Promise<void>` (`git update-ref`)
- constant `FROZEN_REF_PREFIX = "refs/skilltree/frozen/"`

## Naming note

`install --frozen` already means "install strictly from the lockfile". Code uses `frozenTag` / `dep.frozen` to keep them distinct; docs in Phase 3 must disambiguate. Raised with the user at the end of the phase.

## Tasks (TDD order)

- [ ] T1 validation tests (red) → `frozen` type + `validateFrozen` (green)
- [ ] T2 #203 end-to-end resolver test (red) → skip frozen in `resolveRepoVersions`, `resolveFrozen`, resolution keys (green)
- [ ] T3 transitive same-repo test at frozen ref (red) → key lookups via `parentEntity.frozen` (green)
- [ ] T4 capped-warning tests with frozen siblings
- [ ] T5 preserved-ref tests: written, tag deleted, tag moved, nothing preserved (red) → git.ts ref helpers + outcomes (green)
- [ ] T6 lockfile consistency: changed `frozen:` re-resolves; lockfile install keeps frozen commit
- [ ] T7 harden pass: tsc, biome, full suite; RETRO
