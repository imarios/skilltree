# Phase 2 — Retro

## What went well

- Recording `frozen` in the lockfile (user decision at the start of the phase) made most of the phase small. `outdated` reads frozen state straight from the lockfile, `list` renders it, and `unfreeze` needed no lockfile surgery: the manifest/lockfile diff already sees the change.
- Every command test was red before its implementation, and each red failure was the expected one (missing export, missing field, missing message), which kept the green runs meaningful.
- `update` needed almost nothing: resolution already keeps frozen deps at their tag, so the work was two sentences of output.

## What was harder than planned

- **Reinstall didn't replace files.** The first `freeze` deleted the dep's lockfile entry to force re-resolution. `planInstall` gets the previous commit from that entry and only overwrites stale files when it has one (#119 Bug B), so FR1/UF1 updated the lockfile but left the old skill on disk. Fix: keep the entry and clear only its `frozen` marker, and only when freezing.
- **Pre-commit checks the whole tree.** A red test importing a module that didn't exist yet blocked an unrelated commit. Commits now wait until every file in the tree type-checks.

## Decisions made during the phase

- Lockfile gets an optional `frozen` field; `outdated --check` ignores frozen rows (user).
- `freeze`/`unfreeze` find deps by yaml key, like `update`.
- `freeze` drops `version:` and says so; `unfreeze` returns the dep to `*`.
- `freeze` restores the manifest and lockfile bytes if the install fails.
- Re-freezing overwrites the preserved ref, so the "tag moved" warning's advice is true.
- `frozen` is not in `add`'s `PRESERVED_FIELDS` (it's a version pin); re-adding warns instead.
- `list --json` keeps `version` plain and adds `frozen`; only the table appends "(frozen)".

## Carry into Phase 3

- Repo-key normalization: `resolveRepoVersions`, `classifyDep` (`dep.repo !== locked.repo`), `outdated`'s `constraintsByRepo`, and selective `update`'s same-repo clearing all compare raw repo strings.
- Docs: `freeze`/`unfreeze` in README command table, reference.md (manifest field, lockfile field, errors/warnings), spec.md, decisions.md #1, skills/skilltree/references/commands.md.
