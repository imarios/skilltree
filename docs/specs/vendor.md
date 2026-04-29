# Vendor Mode

**Version**: 1.0 (draft)
**Date**: 2026-04-02

Vendor mode copies all resolved dependencies into the project as real files and commits them to git. Consumers of the repo get working skills without running `skilltree install` or having access to any upstream repos.

## The Problem

A maintainer's skills come from a private repo (or a repo they don't want to expose yet). They publish a bootstrap/template repo for others to clone. Without vendoring:

1. Consumer clones the repo
2. Consumer runs `skilltree install`
3. **Fails** — no access to the private repo

The maintainer needs to ship the resolved skills inside the repo so `git clone` is all that's needed.

## Design Principle

**Vendor mode is a distribution mechanism, not a replacement for skilltree.**

`skilltree.yml` + `skilltree.lock` remain the source of truth. The vendored files are a derived snapshot — like a build output that happens to be committed. The maintainer can update deps, re-vendor, and push. The consumer never needs to know skilltree exists.

## How It Works

### Entering vendor mode

```bash
$ skilltree vendor

Resolving dependencies...
Copying 5 entities to .claude/

  python-coding@2.1.3   copied
  testing@2.1.3          copied (transitive)
  my-style               copied (from ./skills/my-style)
  linting@2.1.3          copied (transitive)
  code-review@2.1.3      copied (transitive)

Updated skilltree.yml (vendor: true)
Updated .gitignore (removed .claude/skills/, .claude/agents/)

Vendor complete. Run `git add .claude/` to commit vendored files.
```

What happens:
1. Resolves deps (runs full resolution if no lockfile, lockfile-first otherwise — same as `install`)
2. Copies **all** deps to `dev_install_path` (`.claude/` by default) as real files — no symlinks
3. Sets `vendor: true` in `skilltree.yml`
4. Removes `.claude/skills/` and `.claude/agents/` from `.gitignore` so they can be committed
5. Sets copied files read-only (`chmod 444`/`555`) — same as remote deps in normal mode

### Exiting vendor mode

```bash
$ skilltree unvendor

Deleted vendored files from .claude/skills/ and .claude/agents/
Updated skilltree.yml (vendor: false)
Updated .gitignore (added .claude/skills/, .claude/agents/)

Run `skilltree install` to restore normal mode.
```

What happens:
1. Deletes all skilltree-managed files from `.claude/skills/` and `.claude/agents/` (tracked in lockfile)
2. Sets `vendor: false` (or removes the field) in `skilltree.yml`
3. Re-adds `.claude/skills/` and `.claude/agents/` to `.gitignore`
4. Does NOT run `skilltree install` automatically — the user decides when

### Updating vendored deps

```bash
$ skilltree update python-coding    # updates lockfile as normal
$ skilltree vendor                  # re-copies with new versions

  python-coding   2.1.3 -> 2.2.0   updated
  testing         2.1.3 (unchanged)
  ...

$ git add .claude/ skilltree.lock
$ git commit -m "update python-coding to 2.2.0"
```

`skilltree vendor` is idempotent. Running it again overwrites the vendor directory with fresh copies from the current lockfile state.

### The full round-trip

```bash
# Maintainer starts in normal mode
skilltree install                      # symlinks in .claude/, gitignored

# Maintainer switches to vendor mode
skilltree vendor                       # copies to .claude/, now committable
git add .claude/ skilltree.yml
git commit -m "vendor skills"
git push

# Consumer clones — everything works
git clone bootstrap-repo
cd bootstrap-repo
# .claude/skills/ populated. Claude Code works immediately.
# No skilltree install needed. No private repo access needed.

# Consumer later gets private repo access and wants normal mode
skilltree unvendor
skilltree install                      # back to symlinks
git commit -m "switch to normal mode"

# Maintainer updates a dep
skilltree update python-coding
skilltree vendor
git add .
git commit -m "bump python-coding to 2.2.0"
```

## Manifest Field

```yaml
# skilltree.yml
name: my-bootstrap-project
vendor: true                          # set by skilltree vendor/unvendor

dependencies:
  python-coding:
    repo: github.com/private-org/skills
    path: skills/python-coding
    version: "^2.0.0"
  my-style:
    local: ./skills/my-style
```

`vendor:` is a boolean, default `false`. Set automatically by `skilltree vendor` and `skilltree unvendor`. Can be set manually.

## How Each Dep Type Is Vendored

| Dep type | Normal mode (`install`) | Vendor mode (`vendor`) |
|---|---|---|
| Remote | Copied from git cache | Copied from git cache (same) |
| Local (symlinked) | Symlink to source path | **Copied** — symlink resolved, content snapshotted |
| Transitive | Same as parent's type | Copied (always) |

The critical difference is local deps: normal mode symlinks them (instant editing), vendor mode copies them (committed snapshot). If you edit a local skill source after vendoring, the vendored copy is stale until you re-run `skilltree vendor`.

## Interaction with `skilltree install`

When `vendor: true`:

```bash
$ skilltree install
Warning: Vendor mode is active. Vendored files in .claude/ are committed to git.

  To update vendored files:  skilltree vendor
  To exit vendor mode:       skilltree unvendor

No changes made.
```

`install` refuses to run in vendor mode. This prevents accidentally replacing committed copies with symlinks (which would show up as deletions in git status). The user must explicitly choose `vendor` or `unvendor`.

Exception: `skilltree install --force` overrides this and runs a normal install (symlinks + copies). This is an escape hatch, not the normal workflow.

## Interaction with Other Features

### `--prod` and `src_install_path`

`vendor` copies **all deps** (both `dependencies` and `dev-dependencies`) to `dev_install_path`. It does not interact with `src_install_path` or `--prod`. These are orthogonal:

- `vendor` = "commit deps so consumers don't need skilltree"
- `--prod` + `src_install_path` = "install only prod deps for the application runtime"

If a project uses both, the workflows are independent:
```bash
skilltree vendor                     # all deps → .claude/ (committed)
skilltree install --prod             # prod deps only → src_install_path (separate)
```

### `--frozen`

`skilltree vendor --frozen` works: use lockfile as sole source of truth, copy locked versions to `.claude/`. Same semantics as `install --frozen` but with copy-all behavior. Useful in CI to re-vendor without risking resolution changes.

### `--dry-run`

`skilltree vendor --dry-run` shows what would be copied without making changes.

### Global deps

`vendor` is project-scoped only. No `skilltree vendor --global` — global deps are personal and never committed.

### `.gitignore` management

`skilltree vendor` and `unvendor` modify `.gitignore` to add/remove `.claude/skills/` and `.claude/agents/`. They do NOT touch other `.claude/` entries (settings, MCP config, etc.). If `.gitignore` has a blanket `.claude/` ignore, `vendor` replaces it with specific exclusions:

```gitignore
# Before vendor (blanket ignore from skilltree init)
.claude/skills/
.claude/agents/

# After vendor (skills and agents are now tracked)
# .claude/skills/ and .claude/agents/ are vendored — do not add to gitignore
```

If the user has custom `.gitignore` patterns for `.claude/`, `vendor` warns and asks for confirmation before modifying.

## Edge Cases

- **`vendor` with no lockfile:** Runs full resolution first (creates lockfile), then copies. Same as running `install` then `vendor`.
- **`vendor` when already vendored:** Idempotent. Overwrites existing vendored files with fresh copies. Useful after `update`.
- **`unvendor` when not vendored:** Warns and does nothing.
- **`vendor` + local dep edited after vendoring:** Vendored copy is stale. `skilltree verify` detects this: `my-style STALE (local source newer than vendored copy)`. Fix: re-run `skilltree vendor`.
- **`vendor` with `dev_install_path` set to non-default:** Copies to whatever `dev_install_path` is. `.gitignore` updates target that path.
- **Consumer runs `skilltree update` on vendored repo:** Works — updates lockfile. They still need to `skilltree vendor` to update the committed files. If they don't have access to the private repo, `update` fails (expected — they can't update what they can't reach).
- **Consumer runs `skilltree add` on vendored repo:** Works — adds to manifest. `skilltree vendor` to materialize. If the new dep is from an accessible repo, it works. If private, fails.
- **Mixed: some deps accessible, some not:** `vendor` fails if any dep can't be resolved. The maintainer must vendor from a machine with full access.
- **Vendored files modified by consumer:** `skilltree vendor` overwrites all managed files (same as `install --force` for remote deps). The consumer's local edits are lost. `verify` detects modifications before `vendor` and warns.
- **Integrity hashes:** Vendored files get integrity hashes in the lockfile (same as remote copied deps). `verify` checks them.
- **Read-only permissions:** Vendored files are `chmod 444`/`555` (same as remote deps in normal mode). This signals "don't edit these directly."

## Verify in Vendor Mode

`skilltree verify` gains vendor-aware checks:

```bash
$ skilltree verify
  python-coding@2.1.3   OK
  testing@2.1.3          OK
  my-style               STALE (local source newer than vendored copy)
  code-review@2.1.3      MODIFIED (vendored copy was edited)
```

| Status | Meaning |
|---|---|
| `OK` | Vendored copy matches lockfile integrity hash |
| `STALE` | Local dep's source has changed since last `vendor` |
| `MODIFIED` | Vendored file was edited (integrity mismatch) |
| `MISSING` | Lockfile entry exists but vendored file not found |

## Design Decisions

### 25. Vendor copies into `dev_install_path`, not a separate directory

**Decided:** `skilltree vendor` writes to `.claude/` (or whatever `dev_install_path` is), the same location `install` uses.

**Why:** Claude Code reads from `.claude/skills/` and `.claude/agents/`. A separate `vendor/` directory would require Claude Code configuration to read from a different path — extra setup that defeats the purpose of "clone and it works." Using the same path means zero Claude Code configuration for the consumer.

**Trade-off:** `.gitignore` must be toggled. This is a small cost for a big UX win.

### 26. `install` refuses to run in vendor mode

**Decided:** When `vendor: true`, `skilltree install` warns and does nothing. Forces explicit `vendor` or `unvendor`.

**Why:** Running `install` in vendor mode would replace committed copies with symlinks, showing massive deletions in `git status`. This is always wrong — either the user wants to update vendored files (`vendor`) or exit vendor mode (`unvendor`). Refusing prevents a confusing git state.

### 27. `vendor` includes dev-dependencies

**Decided:** `vendor` copies all deps (both groups), not just `dependencies`.

**Why:** The consumer needs the same development experience as the maintainer. If `python-coding` is a dev-dep that helps with coding, the consumer needs it too. The dev/prod split is about what ships in the product runtime, not about what developers need. Vendoring is about developer experience.

### 28. Local deps are snapshotted (copied, not symlinked)

**Decided:** Local deps are resolved and copied as real files during `vendor`, losing the instant-edit symlink behavior.

**Why:** Symlinks can't be committed to git in a portable way. A symlink to `./skills/my-style` would work only if the consumer also has that source directory — but the whole point of vendoring is to not require anything beyond `git clone`. The copy is a snapshot; re-run `vendor` after editing the source.

### 29. Vendor mode is reversible

**Decided:** `skilltree unvendor` cleanly exits vendor mode and restores normal operation.

**Why:** Vendoring is a distribution choice, not a permanent commitment. A project might start vendored (bootstrap phase), then switch to normal mode once contributors have repo access. Or vice versa — start normal, vendor when going public. The transition must be clean in both directions.
