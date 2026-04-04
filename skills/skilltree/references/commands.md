# skilltree Command Reference

## `skilltree init`

Create a new `skilltree.yaml` and update `.gitignore`.

```bash
skilltree init              # Project manifest
skilltree init --global     # Global manifest (~/.skilltree/global.yaml)
```

**Flags:**
- `-g, --global` — Initialize global dependencies instead of project

Creates `skilltree.yaml` with project name from directory, adds `.claude/skills/` and `.claude/agents/` to `.gitignore`.

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
- `-t, --type <skill|agent>` — Override type inference
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
- `--type <skill|agent>` — Filter by entity type
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

Generate `skillkit-index.yaml` for a skill repo. For repo maintainers.

```bash
skilltree registry index           # Generate index
skilltree registry index --check   # Check if index is up to date (CI mode)
```

**Flags:**
- `--check` — Exit 0 if up to date, exit 1 if stale

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

Sets `vendor: true` in `skilltree.yaml` and removes `.claude/skills/` and `.claude/agents/` from `.gitignore`.

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

```bash
skilltree targets list
```

## `skilltree targets add <target>`

Add an agent or custom path to `install_targets` in `skilltree.yaml`.

```bash
skilltree targets add codex         # Add a known agent
skilltree targets add ./my-agent    # Add a custom path
```

## `skilltree targets remove <target>`

Remove an agent or path from `install_targets`.

```bash
skilltree targets remove codex
```

## `skilltree targets detect`

Scan for installed coding agents and add any missing ones to `install_targets`.

```bash
skilltree targets detect
```

## `skilltree targets migrate`

Convert legacy `dev_install_path` to the new `install_targets` field.

```bash
skilltree targets migrate
```

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
