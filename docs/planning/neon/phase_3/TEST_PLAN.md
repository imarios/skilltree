# Phase 3 — Test Plan

## tests/core/canonical-repo.test.ts (parametrized, hardening pattern #4)

- **CR1** equivalent spellings map to one key: `github.com/elastic/agent-skills`, `github.com/elastic/agent-skills.git`, `https://github.com/elastic/agent-skills`, `https://github.com/elastic/agent-skills.git`, `http://github.com/elastic/agent-skills`, `git@github.com:elastic/agent-skills`, `git@github.com:elastic/agent-skills.git`, `github.com/elastic/agent-skills/`.
- **CR2** different repos stay different: `github.com/elastic/agent-skills` vs `github.com/elastic/agent-skill`, vs `github.com/other/agent-skills`, vs `gitlab.com/elastic/agent-skills`.
- **CR3** local `file://` URLs: `file:///tmp/x/upstream.git` and `file:///tmp/x/upstream.git/` share a key.

## tests/core/graph-repo-spellings.test.ts

Fixture: Phase 1 elastic fixture (v0.4.0 / v0.6.0), bare dir named `agent-skills.git`, spellings `file://<bare>` and `file://<bare>/`.

- **RS1** `removed-a` (`<0.5.0`, spelling A) + `stable` (`*`, spelling B) → one resolution: both at 0.4.0, and a capped warning that mentions `skilltree freeze`. (Before: 0.4.0 and 0.6.0, no warning — the workaround.)
- **RS2** `removed-a` (`0.4.0` exact, A) + `kibana-agent-builder` (`^0.6.0`, B) → exactly one "Version conflict" error whose Fix mentions `skilltree freeze`.
- **RS3** `removed-a` frozen 0.4.0 (A) + `kibana-agent-builder` `*` (B) → resolves as in FZ1: the supported replacement for the workaround.

## Repo comparisons outside the resolver

- **RC1** `diffManifestLockfile`: manifest repo `github.com/x/y.git`, lockfile repo `github.com/x/y` → `unchanged`.
- **RC2** `outdated --json`: a `*` dep and a tight sibling written with different spellings → `cappedBy` names the sibling.
- **RC3** `update <name>` with siblings spelled differently → the "Cleared N lockfile entries" count includes both.
- **RC4** `canonicalSource` of `{repo: "github.com/x/y"}` and `{repo: "https://github.com/x/y.git"}` are equal.

## Messages

- **MS1** error-attribution snapshot updated for the new conflict `Fix:` wording; no other snapshot drift.

## Verification

- `bun test` (timeboxed), `bunx tsc --noEmit`, `bunx biome check`.
- Manual smoke (`bun run dev --`): in a scratch project against a real tagged public repo, `add` two skills, `freeze` one at an older tag, `install`, `list`, `outdated`, `update`, `unfreeze`.
