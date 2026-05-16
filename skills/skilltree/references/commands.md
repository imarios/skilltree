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

Show detailed information about a skill or agent from registries.

```bash
skilltree info python-coding
skilltree info python-coding --json
```

Shows entity type, registry, path, description, tags, available versions, and a copy-pasteable `add` command.

**Flags:**
- `--json` — Machine-readable JSON output

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
skilltree vendor              # Copy all deps, set vendor: true
skilltree vendor --frozen     # Use lockfile only
skilltree vendor --dry-run    # Show plan without making changes
```

**Flags:**
- `--frozen` — Use lockfile only, error if out of sync
- `-n, --dry-run` — Show plan without writing files

Sets `vendor: true` in `skilltree.yml` and removes `.claude/skills/` and `.claude/agents/` from `.gitignore`.

## `skilltree unvendor`

Exit vendor mode. Deletes vendored files and restores `.gitignore`.

```bash
skilltree unvendor           # Errors if vendored files were modified
skilltree unvendor --force   # Discard modifications and unvendor
```

**Flags:**
- `-f, --force` — Discard modified vendored files without error

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
