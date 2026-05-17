# skilltree Command Reference

## `skilltree init`

Create a new `skilltree.yml` and update `.gitignore`.

```bash
skilltree init              # Project manifest
skilltree init --global     # Global manifest (~/.skilltree/global.yaml)
```

**Flags:**
- `-g, --global` — Initialize global dependencies instead of project

Creates `skilltree.yml` with project name from directory, adds `.claude/skills/` and `.claude/agents/` to `.gitignore`.

## `skilltree add <name>`

Add a dependency to the manifest.

```bash
# Registry-assisted (resolves repo+path from registries)
skilltree add python-coding
skilltree add python-coding --version "^2.0.0"
skilltree add python-coding --registry my-registry

# Remote dependency (explicit)
skilltree add code-review --repo github.com/org/skills --path skills/code-review --version "^2.0.0"

# Remote with source shorthand
skilltree add linting --source shared --path skills/linting --version "^2.0.0"

# Local dependency (symlinked)
skilltree add my-style --local ./skills/my-style

# Dev dependency
skilltree add testing --dev --repo github.com/org/shared-skills --path skills/testing
```

**Flags:**
- `-r, --repo <url>` — Git repository URL (mutually exclusive with `--local`)
- `--source <alias>` — Source alias from `sources:` map (mutually exclusive with `--repo`)
- `-p, --path <path>` — Path within the repository (required for remote deps)
- `-v, --version <constraint>` — Semver constraint (default: `"*"`)
- `-l, --local <path>` — Local filesystem path (mutually exclusive with `--repo`/`--source`)
- `-D, --dev` — Add to `dev-dependencies` instead of `dependencies`
- `-t, --type <skill|agent|command>` — Override type inference (commands install to `.claude/commands/`)
- `--registry <name>` — When no `--repo`, resolve from this registry only (disambiguates multiple matches)
- `-g, --global` — Add to global dependencies (~/.skilltree/global.yaml)

## `skilltree new`

Scaffold a new skill, agent, or command at the conventional path with valid frontmatter, then auto-register it as a local dependency.

```bash
# Subcommand form
skilltree new skill my-skill           # writes skills/my-skill/SKILL.md
skilltree new agent my-agent           # writes agents/my-agent.md
skilltree new command my-command       # writes commands/my-command.md

# --type form (equivalent)
skilltree new my-skill --type skill

# Scaffold only — don't touch the manifest
skilltree new skill my-skill --no-register

# Register under dev-dependencies
skilltree new skill testing-helpers --dev
```

**Flags:**
- `-D, --dev` — Register as dev-dependency
- `--no-register` — Scaffold only; skip the implicit `add --local`
- `-t, --type <skill|agent|command>` — Entity type (alternative to the subcommand form)

**Behavior:**
- Refuses to overwrite an existing file at the target path
- After scaffolding, runs the equivalent of `skilltree add <name> --local <path> --type <type>`
- Names must start with a letter or digit and contain only letters, digits, hyphens, and underscores

## `skilltree install`

Resolve dependencies and install them.

```bash
skilltree install              # Full install (dev + prod)
skilltree install --prod       # Production only
skilltree install --frozen     # CI mode — lockfile only
skilltree install --dry-run    # Show plan, don't write
skilltree install --force      # Overwrite modified files
skilltree install --install-path ./build/.claude  # Docker build
```

**Flags:**
- `--prod` — Skip `dev-dependencies`
- `--frozen` — Use lockfile only, error if out of sync (like `npm ci`)
- `-f, --force` — Overwrite locally modified installed files
- `-n, --dry-run` — Show install plan without writing files
- `--install-path <path>` — Override install directory; copies local deps instead of symlinking
- `-g, --global` — Install global dependencies to ~/.claude/

**Behavior:**
- First install (no lockfile): full resolution, creates lockfile
- Subsequent installs: reads lockfile, no re-resolution
- Manifest changed: resolves new/changed entries only
- Local deps: always re-read from filesystem

## `skilltree update [name]`

Re-resolve versions and reinstall.

```bash
skilltree update                  # Update all
skilltree update code-review      # Update one (bumps all same-repo entities)
skilltree update --dry-run        # Preview without applying
skilltree update --global         # Update global deps
```

**Flags:**
- `-n, --dry-run` — Preview version bumps without applying
- `-g, --global` — Update global dependencies

## `skilltree outdated [name]`

Read-only preview of dependency drift. Reports which deps have newer semver tags available upstream without modifying the lockfile or manifest. Counterpart to `skilltree update`.

```bash
skilltree outdated                 # Show all deps with drift status
skilltree outdated python-coding   # Filter to one dep
skilltree outdated --json          # Machine-readable output
skilltree outdated --check         # Exit 1 if any drift exists (CI gate)
skilltree outdated --global        # Inspect global deps
```

**Flags:**
- `--json` — Output results as JSON
- `--check` — Exit 1 if any drift exists (CI-friendly)
- `-g, --global` — Show global deps

**Output columns:** `Name`, `Current` (semver pin / `@<short-sha>` / `local`), `Latest` (latest semver tag on the resolved repo), `Bump` (`major` / `minor` / `patch` / `—`). Local deps and unresolved deps show `—`; a network/cache failure for a remote shows `error` in the Bump column.

## `skilltree projects`

Read-only inventory of skilltree-managed projects discoverable on this machine. Walks the filesystem from `--root` (default `$HOME`) and reports every directory that contains a `skilltree.yml` / `skilltree.yaml`. Counterpart to `skilltree list`, but cross-project — useful when you have many checkouts and want to know what's where.

```bash
skilltree projects                           # Walk $HOME
skilltree projects --root ~/Projects         # Limit to a subtree
skilltree projects --json                    # Machine-readable output
```

**Flags:**
- `--root <path>` — Search root (default: `$HOME`)
- `--json` — Output results as JSON

**Output columns:** `Path`, `Deps` (count of `dependencies` + `dev-dependencies`), `Vendor` (`yes` if `vendor: true`), `Last install` (relative mtime of `skilltree.lock`, or `—` when no lockfile exists).

**Discovery rules:** Skips `node_modules/`, `.git/`, `.skilltree/cache/`, `dist/`, `build/`, and hidden dirs (except `.claude/`). Stops descending once a manifest is found. Does not cross filesystem boundaries or follow symlink cycles. Unparseable manifests are skipped with a warning.

## `skilltree remove <name>`

Remove a dependency from manifest, lockfile, and installed files.

```bash
skilltree remove code-review
skilltree remove code-review --force       # Skip dependents warning
skilltree remove code-review --keep-files  # Remove from manifest but keep files
skilltree remove code-review --global     # Remove from global deps
```

**Flags:**
- `-f, --force` — Skip dependents warning
- `--keep-files` — Remove from manifest but keep installed files
- `-g, --global` — Remove from global dependencies

Cleans orphaned transitive dependencies (cascading). Errors if target is transitive-only (not in manifest).

## `skilltree verify`

Check installed files against lockfile integrity hashes.

```bash
skilltree verify
skilltree verify --global
```

**Flags:**
- `-g, --global` — Verify global dependencies

Reports: `OK` (matches), `MODIFIED` (changed), `LINKED` (symlink), `MISSING`, `STALE` (vendored local dep with newer source), `BROKEN` (dead symlink).

## `skilltree check`

Design-time lint of `skilltree.yml`. Currently catches **asymmetric publish state** — a publicly-visible local entity that depends (directly or transitively) on a same-repo `publish: false` entity. Your own install succeeds; downstream consumers fail at install time on the transitive `publish: false`.

```bash
skilltree check
skilltree check --strict
```

**Flags:**
- `--strict` — Exit 1 if any warnings are found

Each warning shows the chain (`A → B → C (publish: false)`) so the fix is obvious: either remove `publish: false` on the leaf or break the dependency chain.

## `skilltree doctor`

Preflight health check bundling every per-area inspection into one verb. Run before `git tag` to confirm "am I ready to publish?"; run after `git clone` to confirm "is this project healthy?"

```bash
skilltree doctor
skilltree doctor --json
skilltree doctor --global
```

**Flags:**
- `--json` — Emit the report as JSON instead of the text table. Exit codes unchanged.
- `--global` — Run against `~/.skilltree/global.yml`. Project-scoped checks (lockfile, target-consistency) become `skip` rows; registry-reachability still runs (registries are global config).

Checks performed (in order):

1. **manifest-schema** — `skilltree.yml` parses and validates.
2. **lint** — wraps `skilltree check` (asymmetric publish + frontmatter validity).
3. **lockfile-sync** — `skilltree.lock` has no `added` / `removed` / `changed` entries vs the manifest.
4. **target-consistency** — every `install_targets` entry resolves through the agent registry or is a literal path that exists.
5. **registry-reachability** — each configured registry reachable via `git ls-remote` (5s timeout). Auth-required and timeout are reported as warnings, not failures.
6. **frontmatter** — same as lint #2; reported separately for output readability.

Exit codes:

- `0` — all checks passed (warnings are allowed).
- `1` — at least one check failed.

JSON shape (stable across versions; `detail` and `fix` are omitted when absent):

```json
{
  "checks": [
    { "name": "manifest-schema", "status": "pass" },
    { "name": "lockfile-sync", "status": "fail", "detail": "1 added (foo)", "fix": "Run `skilltree install` to sync" }
  ],
  "summary": { "pass": 4, "warn": 1, "fail": 1, "skip": 0 }
}
```

Read-only: `doctor` never writes to disk, mutates the manifest, or touches the cache. The only network call is the per-registry `git ls-remote` from #5.

Lifecycle: `new → check → doctor → git tag`.

## `skilltree list`

Show installed dependencies in a table.

```bash
skilltree list
skilltree list --json
skilltree list --global
```

**Flags:**
- `--json` — Machine-readable JSON output
- `-g, --global` — List global dependencies

## `skilltree deps tree`

Show the dependency tree with dedup markers.

```bash
skilltree deps tree
skilltree deps tree --global
```

**Flags:**
- `-g, --global` — Show global dependency tree

## `skilltree why <name>`

Reverse-lookup which top-level dependency pulled in `<name>`. Reads the lockfile only and walks the resolved graph backwards from the target to every reachable top-level dep. Mirrors the `npm why` / `cargo why` mental model — useful when you spot something installed and want to know who's responsible for it.

```bash
skilltree why python-coding
skilltree why foo --type agent      # disambiguate a name shared by skill+agent
skilltree why something --json      # machine-readable
skilltree why bar --global          # inspect global lockfile
```

**Flags:**
- `-t, --type <type>` — Disambiguate when `<name>` matches multiple entity types (`skill`, `agent`, `command`)
- `--json` — Output paths as JSON
- `-g, --global` — Inspect the global lockfile

## `skilltree scan <paths...>`

Detect undeclared dependencies in skill body text using regex patterns.

```bash
skilltree scan ./skills/                    # Scan all skills
skilltree scan --check ./skills/            # Pre-commit mode (exit 1 if gaps)
skilltree scan --apply ./skills/            # Auto-update frontmatter
skilltree scan --llm ./skills/              # LLM-assisted deep scan
skilltree scan --json ./skills/             # Machine-readable output
```

**Flags:**
- `--check` — Exit 1 if undeclared deps found (pre-commit safe)
- `--apply` — Auto-add regex-detected deps to frontmatter (not LLM suggestions)
- `--llm` — Use Claude for semantic dependency detection (requires `ANTHROPIC_API_KEY`)
- `--json` — JSON output

## `skilltree registry init`

Seed popular community registries for skill discovery. Adds curated defaults (Trail of Bits, Cybersecurity, Microsoft) and indexes them.

```bash
skilltree registry init                # Add defaults and index
skilltree registry init --skip-update  # Add without indexing
```

**Flags:**
- `--skip-update` — Add registries without fetching and indexing them

Skips any registries that are already configured (by name or URL). Safe to run multiple times.

## `skilltree registry add <url>`

Register a git repo as a searchable registry for skill discovery.

```bash
skilltree registry add github.com/org/shared-skills
skilltree registry add github.com/company/private-skills --name internal
```

**Flags:**
- `--name <alias>` — Custom name for the registry (default: last path segment of URL)

## `skilltree registry remove <name>`

Remove a registered registry and clean its cache.

```bash
skilltree registry remove internal
```

## `skilltree registry list`

List all registered registries with entity counts and last update timestamps.

```bash
skilltree registry list
skilltree registry list --json
```

**Flags:**
- `--json` — Machine-readable JSON output

## `skilltree registry update [name]`

Fetch registry repos and rebuild local search index cache.

```bash
skilltree registry update           # Update all registries
skilltree registry update my-registry  # Update one registry
```

## `skilltree search <query>`

Search across registered registries for skills and agents.

```bash
skilltree search python
skilltree search security --type agent
skilltree search "code review" --registry my-registry
skilltree search python --json
```

**Flags:**
- `--registry <name>` — Search only one registry
- `--type <skill|agent|command>` — Filter by entity type
- `--json` — Machine-readable JSON output

## `skilltree info <name>`

Show detailed information about a skill or agent. Looks across three layers in order:

1. **`skilltree.lock`** — most authoritative (installed state: source, version, commit, integrity)
2. **`skilltree.yml`** — manifest declaration (may not yet be installed)
3. **Registries** — catalog of available skills

If the name is found in multiple layers, each is shown as its own `[lockfile]` / `[manifest]` / `[registry: <name>]` section. Lockfile and manifest layers work even with no registries configured, so introspecting your own installed deps never asks you to set up a registry first.

```bash
skilltree info python-coding
skilltree info python-coding --json
```

Exit code is `0` when found in any layer, `1` only when the name is absent from lockfile, manifest, **and** all configured registries.

**Flags:**
- `--json` — Machine-readable JSON output (array of layer-tagged objects)

## `skilltree registry index`

Generate `skilltree-index.yml` at the **root of a skill repo** so the repo is discoverable via `skilltree search` / `skilltree info`. For repo maintainers.

**When you need this:** publishing a repo where skills/agents live in **non-standard locations**. Dynamic scanning (the fallback when no index is present) only reliably finds:

- skills at `**/SKILL.md`
- agents at `*.md` outside any skill dir, with `name:` or `skills:` frontmatter
- slash-commands under a `commands/` path segment

If your repo uses unconventional layouts (e.g., skills nested under `packages/*/skill/`, agents without `name:` frontmatter, curated subsets of a larger monorepo, files that need extra `tags:` for search), the index file is the answer — it explicitly lists every entity with its path, description, and tags, overriding the scanner.

It also lets you ship `tags:` (not in the SKILL.md spec) and speeds up search by skipping the tree walk.

```bash
skilltree registry index           # Generate/refresh skilltree-index.yml at repo root
skilltree registry index --check   # Exit 1 if stale (CI mode)
```

**Flags:**
- `--check` — Exit 0 if up to date, exit 1 if stale

**What `--check` validates:** every entity the scanner finds must be present in the index with matching `name`, `type`, and `description`; every other entry in the index must point to a real on-disk entity (a `SKILL.md` for skills, or a markdown file with `name:`/`skills:` frontmatter for agents and commands). Hand-authored entries for skills/agents at scanner-unreachable paths (nested under a parent `SKILL.md`, monorepo packages, etc.) and curated `tags:` are preserved — they do not trip `--check` as long as the path resolves. Phantom entries (paths that don't exist) still fail.

**Publishing workflow:** run `skilltree registry index` and commit `skilltree-index.yml`. Wire `--check` into CI so the index never drifts from the actual skill set. Legacy `skillkit-index.yaml` files are migrated automatically — the new file replaces the old one and a deprecation warning is emitted on read until you regenerate.

## `skilltree vendor`

Copy all dependencies as real files (no symlinks) for git commit. Enables distribution without upstream repo access.

```bash
skilltree vendor                # Copy all deps, set vendor: true
skilltree vendor --frozen       # Use lockfile only
skilltree vendor --dry-run      # Show plan without making changes
skilltree vendor --target codex # Pick a target when install_targets has 2+ entries
```

**Flags:**
- `--frozen` — Use lockfile only, error if out of sync
- `-n, --dry-run` — Show plan without writing files
- `--target <name>` — Select an install target by its raw `install_targets` entry (e.g. `claude`, `codex`). Required when the manifest has multiple targets configured; rejected on legacy `dev_install_path` manifests.

Sets `vendor: true` in `skilltree.yml` and removes `.claude/skills/` and `.claude/agents/` from `.gitignore`.

## `skilltree unvendor`

Exit vendor mode. Deletes vendored files and restores `.gitignore`.

```bash
skilltree unvendor                # Errors if vendored files were modified
skilltree unvendor --force        # Discard modifications and unvendor
skilltree unvendor --target codex # Pick a target when install_targets has 2+ entries
```

**Flags:**
- `-f, --force` — Discard modified vendored files without error
- `--target <name>` — Select an install target by its raw `install_targets` entry. Required when the manifest has multiple targets configured.

Checks integrity of vendored files before deleting. If any were modified, errors with a list of changed files. Use `--force` to discard changes, or `skilltree vendor` to overwrite with fresh copies first.

After unvendoring, run `skilltree install` to restore normal symlinked installs.

## `skilltree targets list`

Show all known coding agents with their detection and configuration status.

| Flag | Description |
|------|-------------|
| `--global` | Show global targets |

```bash
skilltree targets list
skilltree targets list --global
```

## `skilltree targets add <target>`

Add an agent or custom path to `install_targets` in `skilltree.yml`.

| Flag | Description |
|------|-------------|
| `--global` | Add to global manifest |

```bash
skilltree targets add codex         # Add a known agent
skilltree targets add ./my-agent    # Add a custom path
skilltree targets add --global codex
```

## `skilltree targets remove <target>`

Remove an agent or path from `install_targets`.

| Flag | Description |
|------|-------------|
| `--global` | Remove from global manifest |

```bash
skilltree targets remove codex
```

## `skilltree targets detect`

Scan for installed coding agents and add any missing ones to `install_targets`.

| Flag | Description |
|------|-------------|
| `--global` | Detect for global manifest |

```bash
skilltree targets detect
```

## `skilltree targets migrate`

Convert legacy `dev_install_path` to the new `install_targets` field. Use this when upgrading an existing project.

| Flag | Description |
|------|-------------|
| `--global` | Migrate global manifest |

```bash
skilltree targets migrate
```

**Migration guide**: If your project uses `dev_install_path: .claude`, run `skilltree targets migrate` to convert to `install_targets: [claude]`. After migrating, you can add more agents with `skilltree targets add codex`. The `targets add/remove/detect` commands require migration first — they will error with a helpful message if `dev_install_path` is still set.

## `skilltree cache clean`

Remove the git cache at `~/.skilltree/cache/`.

```bash
skilltree cache clean
```

## `skilltree teach`

Install the skilltree skill to all detected coding agents.

| Flag | Description |
|------|-------------|
| `--agent <name>` | Install to a specific agent only |

```bash
skilltree teach                  # Install to all detected agents
skilltree teach --agent claude   # Install to Claude Code only
```

## `skilltree completion [shell]`

Output shell completion script for tab completion of commands and flags.

```bash
skilltree completion zsh     # Zsh completion script
skilltree completion bash    # Bash completion script
eval "$(skilltree completion zsh)"   # Enable for current session
```
