# Neon — Frozen Dependencies

Project-Type: production
Sub-Project: Neon (started 09/13/2026)
Issue: [#203](https://github.com/imarios/skilltree/issues/203) — design comment: https://github.com/imarios/skilltree/issues/203#issuecomment-5655095984

Lets a single dependency be **frozen** at an exact tag so it stops taking part in its repo's shared version resolution. Motivating case: `elastic/agent-skills` v0.6.0 removed nine skills and renamed another; pinning the removed ones to `<0.5.0` capped every sibling at 0.4.0, where the renamed path doesn't exist. Today the only way out is spelling the repo URL with a `.git` suffix so the resolver treats it as a different repo.

Decision #1 ("one repo = one version") still holds. Frozen deps are its one explicit exception.

## How the cache works (and why it barely changes)

- One bare clone per repo at `~/.skilltree/cache/<host>/<owner>/<repo>` — no working tree.
- Sync: `clone --bare` once, then `fetch --tags` + `fetch --prune +refs/tags/*:refs/tags/*`.
- Every read is `git show <ref>:<path>` / tree listing at a ref. Nothing checks out. One cache already serves any number of tags.

The only cache change: tag pruning would mirror an upstream tag deletion or re-point, which is exactly the #203 scenario. A private ref `refs/skilltree/frozen/<tag>` → commit preserves the frozen commit outside `refs/tags/*`.

## Surface

```yaml
dependencies:
  kibana-dashboards:
    repo: github.com/elastic/agent-skills
    frozen: 0.4.0            # exact tag only
```

- `skilltree freeze <name> [tag]` / `skilltree unfreeze <name>` (both with `-g, --global`, `-n, --dry-run`).

## Phases

```
Phase 1: frozen: field + resolver
   │     - RemoteDependency/SourceDependency.frozen, validation (exact semver, no `version:` alongside)
   │     - per-dep resolution: frozen deps skip repo intersection, get their own RepoResolution
   │     - same-repo transitive deps resolve at the parent's (frozen) ref
   │     - #119 capped warning ignores frozen deps
   │     - preserved ref refs/skilltree/frozen/<tag>; deleted/re-pointed tag fallback + warnings
   ▼
Phase 2: commands + read surfaces
   │     - freeze / unfreeze commands, CLI wiring, completion, help snapshot
   │     - update: skip frozen deps with a note; selective update of a frozen dep explains
   │     - outdated: frozen rows (no bump advertised as actionable), JSON field
   │     - doctor / list surface frozen state; add preserves `frozen:` on re-add
   ▼
Phase 3: resolution-key normalization + docs
         - repo key normalized (normalizeGitUrl) so `.git`/scheme spellings share one resolution
         - conflicting pins that now meet → error with a hint to use `freeze`
         - decisions.md #1, reference.md, spec.md, README, skills/skilltree/references/commands.md
```

One PR for the whole project (user decision); phases are commits.

## Phase status

- Phase 1: ✅ implemented (2026-09-13) — full-suite run pending
- Phase 2: ⏳ in progress — decisions made: lockfile gets an optional `frozen` field; `outdated --check` ignores frozen rows
- Phase 3: pending

## Definition of Done

- `bun test`, `bunx tsc --noEmit`, `bunx biome check` green
- The #203 scenario reproduced end-to-end in a test: removed skills frozen at 0.4.0, survivors at 0.6.0 including the renamed path, no capped warning
- Frozen dep survives upstream tag deletion (installs preserved commit, warns)
- Docs updated; decisions.md #1 amended
