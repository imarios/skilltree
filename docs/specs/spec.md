# skilltree - Dependency Manager for AI Agent Skills

**Version**: 1.0 (spec)
**Date**: 2026-03-29

Two files (`skilltree.yml` + `skilltree.lock`), one command (`skilltree install`), git repos as the registry. Resolves transitive dependencies, pins versions via git tags, produces lockfiles for reproducibility, handles dev/prod separation, and supports local (symlinked) dependencies for skill authors.

See [background.md](background.md) for why this tool exists and how it compares to alternatives.

## How It Works

### Where dependencies are tracked

| Where | What it tracks | Who writes it |
|-------|---------------|---------------|
| `skilltree.yml` | What you WANT -- repo URLs, version constraints, local paths | You (via `skilltree add` or hand-edit) |
| `skilltree.lock` | What you GOT -- resolved versions, exact commits, integrity hashes, full graph | skilltree (via `skilltree install`) |
| SKILL.md frontmatter | What THIS skill NEEDS -- `dependencies: [name, name]` (name-only, no versions/repos) | Skill author |

The manifest says "I need code-review from this repo at ^2.0.0." The lockfile says "code-review resolved to v2.1.3, commit a1b2c3d." The frontmatter says "code-review needs testing."

### Where files live

Developer skills are **gitignored** -- like `node_modules/`, they're ephemeral:

```
my-project/
├── skilltree.yml              # Checked into git (what you want)
├── skilltree.lock              # Checked into git (what you got)
├── .gitignore                 # Includes .claude/skills/, .claude/agents/, .claude/commands/
├── .claude/                   # dev_install_path (gitignored)
│   ├── skills/                # Populated by `skilltree install`
│   │   ├── code-review/       # Remote dep: copied from git cache
│   │   └── my-style/          # Local dep: symlinked to source
│   ├── agents/
│   │   └── workflow-builder.md
│   └── commands/              # Claude Code slash commands
│       └── review.md
├── src/skills/                # src_install_path (optional -- tracked or gitignored)
│   ├── code-review/           # deps only (not dev-deps)
│   └── my-style/
└── skills/                    # Your source skills (if authoring -- tracked in git)
    └── my-skill/
        └── SKILL.md
```

Delete `.claude/`, run `skilltree install`, everything is back. For Docker: `skilltree install --prod --install-path ./build/.claude` copies to a build directory.

### When resolution runs

The lockfile IS the resolution cache. Once resolved, future installs skip resolution entirely:

| Trigger | Resolution? | Network? |
|---------|-------------|----------|
| First install (no lockfile) | **Full** -- fetch repos, list tags, solve constraints | Yes |
| Install (lockfile current, nothing changed) | **None** -- read lockfile, install locked versions | Fetch content only |
| Install (manifest changed) | **Minimal** -- only new/changed entries | Yes (new repos) |
| Install (has local deps) | **Partial** -- remote from lockfile, local re-read from filesystem | Maybe (if local deps add new transitive deps) |
| `--frozen` (CI) | **None** -- lockfile is sole source of truth | Fetch content at locked commits only |
| `skilltree update` | **Full** -- re-check all tags for newer versions | Yes |

### Two kinds of dependency gaps

**Gap 1 -- "Frontmatter declares a dep that can't be resolved"**
Caught at `skilltree install` time. Resolution tries: resolution context → consumer manifest → local-source probe → origin-manifest lookup → same-repo conventional probe → error. All missing deps reported at once.

```
Error: 2 unresolved dependencies

  1. code-review (from github.com/org/repo) declares dependency "linting",
     not found in:
       - your skilltree.yml
       - already-resolved dependencies
       - origin's skilltree.yml dependencies (github.com/org/repo)
       - conventional paths in github.com/org/repo
  2. code-review (from github.com/org/repo) declares dependency "testing",
     not found in: (same locations as above)
```

**Gap 2 -- "Skill body references a skill not declared in frontmatter"**
Caught by `skilltree scan`, a **completely separate workflow** from install. Scan is an authoring tool, not part of the install path:

```bash
skilltree scan ./skills/my-skill/        # On demand: detect undeclared deps
skilltree scan --check ./skills/         # Pre-commit: exit 1 if gaps found
skilltree scan --apply ./skills/         # Auto-fix: update frontmatter
skilltree scan --llm ./skills/           # Deep: LLM analysis (costs money)
```

These two gaps are independent. A skill can pass `scan --check` (all body references declared) but fail `install` (a declared dep can't be resolved from any repo). Or vice versa.

### Full lifecycle example

```bash
# 1. Start a project
skilltree init                           # Creates skilltree.yml, updates .gitignore

# 2. Declare what you need
skilltree add code-review --repo github.com/org/skills --path skills/code-review --version "^2.0.0"
skilltree add my-style --local ./skills/my-style        # Co-located skill
skilltree add testing --dev --repo github.com/org/shared-skills --path skills/testing

# 3. Resolve and install
skilltree install                        # Full resolution (first time). Creates skilltree.lock.
                                        # Remote deps: copied to .claude/skills/
                                        # Local deps: symlinked to .claude/skills/
                                        # Claude Code can now use all skills.

# 4. Teammate joins
git clone ... && cd project
skilltree install                        # Reads lockfile. No resolution. Same versions guaranteed.

# 5. Author a skill -- scan for gaps
vim skills/my-style/SKILL.md            # Edit body: "Use the linting skill"
skilltree scan --check ./skills/         # Exit 1: linting not in frontmatter
skilltree scan --apply ./skills/         # Auto-adds linting to frontmatter
skilltree install                        # Detects local dep frontmatter changed.
                                        # Resolves linting. Fails if cross-repo + not in manifest.
skilltree add linting --repo github.com/org/shared-skills --path skills/linting
skilltree install                        # Now resolves. Lockfile updated.

# 6. Check for updates
skilltree update --dry-run               # Shows available version bumps
skilltree update code-review             # Bumps code-review + all same-repo entities

# 7. Ship to production (if src_install_path is set in manifest)
skilltree install --prod                 # deps only → src_install_path, copied (not symlinked)
docker build .                          # COPY src/skills /app/skills

# 7b. Ship to production (without src_install_path -- one-off)
skilltree install --prod --install-path ./build/.claude   # deps only → specified path

# 8. CI validation
skilltree install --prod --frozen        # Zero resolution. Lockfile only.
```

## Design Principles

1. **Git is the registry.** No server, database, or Docker. Versions are git tags. Private repos just work.
2. **Dependency resolution is the core value.** What needs installing, in what order, at what version.
3. **Single binary, zero infrastructure.** TypeScript compiled via Bun. State = two files.
4. **Standards-aligned.** SKILL.md standard. Installs to `.claude/skills/`, `.claude/agents/`, and `.claude/commands/`.
5. **Explicit over magic.** Frontmatter `dependencies` is the source of truth. Scanning is an authoring aid.
6. **Installed files are never checked in.** Like `node_modules/` -- gitignored, recreated by `skilltree install`.

## Core Concepts

### Skills, Agents, and Commands

skilltree manages three first-class resource types. They share the same
manifest grammar and resolution pipeline; they differ in shape and
install location.

| Entity | Format | Install Location |
|--------|--------|------------------|
| Skill | Directory with `SKILL.md` + optional `references/` | `.claude/skills/{name}/` |
| Agent | Single `.md` file with YAML frontmatter | `.claude/agents/{name}.md` |
| Command | Single `.md` file with YAML frontmatter (Claude Code slash commands) | `.claude/commands/{name}.md` |

**Type constraint:** Skills can only depend on skills. Agents can depend
on skills (and other agents). Commands can depend on skills (same
relaxation as agents). Agents and commands have the same on-disk shape
(single `.md`); the difference is install location and how Claude Code
loads them — slash commands are user-invoked via `/<name>`.

### Dependencies: Remote vs Local

**Remote** -- fetched from a git repo at a pinned version:
```yaml
code-review:
  repo: github.com/org/shared-skills
  path: skills/code-review
  version: "^2.0.0"
```

**Local** -- symlinked from a co-located path (for skill authors iterating on a skill):
```yaml
my-style:
  local: ./skills/my-style
```

Local deps are **symlinked** during `skilltree install` (edits reflected instantly, no reinstall loop). During `--prod --install-path`, local deps are **copied** (Docker can't follow host symlinks). This follows Cargo's `path` + `version` pattern.

### Dependency Groups and Install Paths

Skills serve two purposes: helping developers write code (dev) and powering the product's AI features at runtime (source). Most users only need the first -- they add skills and everything installs to `.claude/`. The second purpose activates when you set `src_install_path`.

**Simple case (most users):**

All skills go to `.claude/skills/`. No distinction needed between `dependencies` and `dev-dependencies`. Just use `dependencies`:

```yaml
dev_install_path: .claude          # Default -- where the developer's AI agent reads skills

dependencies:
  python-coding:
    repo: github.com/org/shared-skills
    path: skills/python-coding
    version: "^2.0.0"
  my-style:
    local: ./skills/my-style
```

**Advanced case (product ships skills):**

When your product runs AI agents at runtime (via Claude Code SDK or similar), some skills need to be available in the deployed application. Set `src_install_path` to a location in your source tree:

```yaml
dev_install_path: .claude          # For the developer's AI agent (gitignored)
src_install_path: src/skills       # For the application's runtime (tracked or gitignored -- your choice)

dependencies:                      # Installed to BOTH dev_install_path and src_install_path
  deploy:
    local: ./skills/deploy
  code-review:
    repo: github.com/org/shared-skills
    path: skills/code-review
    version: "^2.0.0"

dev-dependencies:                  # Installed to dev_install_path ONLY
  python-coding:
    repo: github.com/org/shared-skills
    path: skills/python-coding
    version: "^2.0.0"
```

When `src_install_path` is set:
- `dependencies` install to **both** paths (developer needs them locally AND the product ships them)
- `dev-dependencies` install to `dev_install_path` **only** (developer helpers that don't ship)
- `skilltree install --prod` installs `dependencies` to `src_install_path` only (CI/Docker builds)

When `src_install_path` is NOT set:
- Both groups install to `dev_install_path` (`.claude/`)
- `--prod` skips `dev-dependencies` and uses `--install-path` for one-off builds
- No distinction in where files go -- only in what `--prod` includes

The user controls whether `src_install_path` is tracked in git (committed, like `go mod vendor`) or gitignored (generated by CI, like `node_modules/`).

| Command | With `src_install_path` | Without `src_install_path` |
|---------|------------------------|---------------------------|
| `skilltree install` | deps → both paths; dev-deps → `.claude/` only | Everything → `.claude/` |
| `skilltree install --prod` | deps → `src_install_path` only | deps → `--install-path` or `.claude/` |

### Origin-Manifest Resolution

A repo that ships its own `skilltree.yml` becomes **self-describing** to downstream consumers. The origin manifest provides name → location mappings that skilltree uses in two places:

**Direct deps, path inference (v2 / R9):** Consumers can omit `path:` on their own `skilltree.yml` entries when origin declares the name. Path is looked up from origin at install time.

```yaml
# Consumer's skilltree.yml — no path: needed
dependencies:
  task-builder:
    repo: github.com/org/analysi-backend
    version: "^0.3.0"
```

When the consumer's `path:` matches origin's declaration, skilltree warns that it's redundant. When it differs, skilltree warns and suggests `force_path: true` to silence the warning if the override is intentional.

**Transitive deps, full resolution:** When a skill's frontmatter declares a dep, skilltree resolves it using this priority:

1. **Resolution context** -- B was already resolved by another chain
2. **Consumer manifest** -- B is in `skilltree.yml` (either group)
3. **Local-source probe** -- A came from a local source directory; look for B inside it. See [global.md](global.md) for local source details.
4. **Origin-manifest lookup** -- A came from a remote repo; read the origin's `skilltree.yml` at the pinned ref and look up B in `dependencies` (NOT `dev-dependencies`). If found as a `local:` entry, treat B as a same-repo dep pinned to A's tag. Lets authors organize repos without following the `skills/<name>/` convention.
5. **Same-repo conventional probe** -- A came from a remote repo; probe `skills/<name>/SKILL.md`, `agents/<name>.md`, `commands/<name>.md`, or `<name>/SKILL.md` at A's repo root.
6. **Error** -- actionable message listing every location checked, with a fix command.

The resolution context grows during graph construction, making resolution order-independent. Manifest entries processed in declaration order (`dependencies` before `dev-dependencies`). See [reference.md](reference.md) for the full origin-manifest lookup semantics (cross-repo entries fall through; malformed origin manifests fall through silently).

**Error collection:** Resolution does NOT halt on the first error. It continues through the entire graph, collecting all unresolvable dependencies, then reports them all at once. This lets the user fix all missing cross-repo deps in one pass instead of iterating through install-fail-fix cycles.

### Versioning

Git tags (`v1.0.0` or `1.0.0`). Tags that don't parse as semver (e.g., `release-2024-01`) are ignored. **One repo = one version** -- all entities in a multi-entity repo share the repo's tags. Multiple constraints on the same repo are intersected; incompatible constraints produce a clear error.

Default version when omitted: `"*"` (latest tag).

### Name Aliasing

When a skill and agent share a name (e.g., `workflow-builder`), use a unique YAML key with a `name:` field for the actual entity name:

```yaml
workflow-builder:               # YAML key = installed name
  local: ./skills/workflow-builder
  type: skill
workflow-builder-agent:         # YAML key = alias
  local: ./agents/source/workflow-builder.md
  type: agent
  name: workflow-builder        # Actual name for installation
```

No filesystem collision (skills, agents, and commands install to different directories).

**Frontmatter disambiguation:** When `dependencies: [workflow-builder]` appears in frontmatter and both a skill and agent match, **skill always takes precedence** (skills depending on skills is the only option; agents depending on skills is the common pattern). There is no frontmatter syntax to target a same-name agent -- this is a known limitation. If an agent needs to depend on another agent that shares a name with a skill, the agent must be renamed to have a unique name. See [decisions.md](decisions.md) #7 for full rules and test scenarios.

## Commands

### `skilltree init`
```bash
$ skilltree init
Created skilltree.yml
Updated .gitignore (added .claude/skills/, .claude/agents/, .claude/commands/)
```

### `skilltree add <name>`
```bash
# Remote dep
$ skilltree add code-review --repo github.com/org/skills --path skills/code-review --version "^2.0.0"

# Dev dep
$ skilltree add python-coding --dev --repo github.com/org/shared-skills --path skills/python-coding

# Local dep
$ skilltree add my-style --local ./skills/my-style

# With source shorthand
$ skilltree add linting --source shared --path skills/linting --version "^2.0.0"

# Slash command (single .md under commands/, installs to .claude/commands/)
$ skilltree add review --repo github.com/org/cmds --path commands/review.md --type command
```

Default version when `--version` omitted: `"*"`. If the name already exists in the manifest, `add` overwrites it (with a warning). To move a dep between groups (dev to prod or vice versa), edit `skilltree.yml` directly and run `skilltree install`.

### `skilltree install`
```bash
$ skilltree install

Resolving dependencies...
  github.com/org/skills: ^2.0.0 -> v2.1.3
    code-review (skill)
    linting (skill, transitive)
  my-style (local, symlinked)

Install order:
  1. skill:my-style (local)
  2. skill:linting@2.1.3
  3. skill:code-review@2.1.3

Installing 3 entities... done.
Updated skilltree.lock
```

**Lockfile behavior:**

| Scenario | Behavior |
|----------|----------|
| No lockfile | Full resolution. Creates lockfile. |
| Lockfile current, no local deps | Install from lockfile. No re-resolution. |
| Lockfile current, has local deps | Remote from lockfile. **Local always re-read from filesystem** (Cargo/npm pattern). |
| Manifest changed | Resolve new/changed entries only. Keep locked versions for rest. |
| `--frozen` | Lockfile is sole source of truth. Skip **version resolution** (no tag listing, no constraint solving). Still fetches repo content at locked commit SHAs (git clone/fetch needed on clean machines). Error if manifest/lockfile out of sync. Local deps still read from filesystem; if local dep's frontmatter adds a transitive dep not in lockfile, error. (Like `npm ci`.) |

**Flags:**
- `--prod` -- Only `dependencies`, skip `dev-dependencies`. Uses `src_install_path` if set, otherwise `--install-path` or the default `.claude/` path.
- `--frozen` -- Lockfile-only, error if out of sync
- `--force` -- Overwrite local modifications
- `--dry-run` -- Show plan without installing
- `--install-path <path>` -- Override target (e.g., `./build/.claude` for Docker). Creates `skills/`, `agents/`, and `commands/` subdirs. Local deps copied, not symlinked. Takes precedence over `src_install_path`.

### `skilltree update [name]`
```bash
# Update one (bumps all entities from same repo)
$ skilltree update code-review
  github.com/org/skills: 2.1.3 -> 2.2.0 (3 entities)
Updated skilltree.lock. Installing...done.

# Update all
$ skilltree update
```

Resolves new versions, updates lockfile, and reinstalls (like `npm update`). `--dry-run` previews version bumps without applying.

### `skilltree remove <name>`
```bash
$ skilltree remove code-review
Warning: ci-pipeline depends on code-review. Remove anyway? [y/N]
```

Removes from manifest, lockfile, and installed files. Cleans orphaned transitive deps (any entity no longer reachable from a remaining manifest entry via the dependency graph, including cascading: if A -> B -> C and A is removed, both B and C are orphaned unless reachable by another path). `--force` skips confirmation. `--keep-files` leaves installed files in place.

### `skilltree deps tree`
```bash
$ skilltree deps tree
ci-pipeline@1.0.0 (agent, local)
├── code-review@2.1.3 (skill, shared)
│   ├── linting@2.1.3 (skill, shared)
│   ├── testing@2.1.3 (skill, shared)
│   └── language-support (skill, local)
├── linting@2.1.3 (deduped)
├── testing@2.1.3 (deduped)
└── deploy (skill, local)
```

### `skilltree verify`
```bash
$ skilltree verify
  code-review      OK
  python-coding    MODIFIED (local changes detected)
  my-style         LINKED (local dep)
```

### `skilltree scan <path>`
```bash
$ skilltree scan ./skills/code-review/      # Detect deps via regex
$ skilltree scan --check ./skills/          # Pre-commit mode (exit 0 or 1)
$ skilltree scan --apply ./skills/          # Auto-update frontmatter
$ skilltree scan --llm ./skills/            # LLM-assisted detection
```

Authoring tool. Regex is free/fast (pre-commit safe). LLM is on-demand only.

### `skilltree list`
```bash
$ skilltree list
Name                Type   Group  Version  Source
code-review         skill  prod   2.1.3    github.com/org/skills
my-style            skill  prod   local    ./skills/my-style
python-coding       skill  dev    2.1.3    github.com/org/shared-skills
```

### `skilltree cache clean`
Removes `~/.skilltree/cache/`. Next install re-fetches.

## Makefile Integration

```makefile
# Developer setup (all skills → .claude/)
dev-setup:
	skilltree install

# Production build (if src_install_path is set in manifest)
docker-build:
	skilltree install --prod
	docker build -t myapp .

# Production build (without src_install_path -- explicit path)
docker-build-explicit:
	skilltree install --prod --install-path ./build/.claude
	docker build -t myapp .

# CI validation
ci-check:
	skilltree install --prod --frozen
```

## Architecture

```
skilltree (TypeScript, compiled to single binary via Bun)
  ├── Manifest Parser (skilltree.yml)
  ├── Lockfile Manager (skilltree.lock)
  ├── Git Client (clone, fetch, checkout tags)
  ├── Dependency Scanner (regex + optional LLM)
  ├── Dependency Resolver (semver + topological sort)
  └── Installer (symlinks for local, copies for remote)
```

**Tech stack:** TypeScript, Bun (compile + test), `simple-git`, `semver`, `yaml`, `commander`. Optional: Anthropic SDK (for `scan --llm`).

**Auth:** Delegated to system git (SSH keys, credential helpers, `GITHUB_TOKEN`).

**Git cache:** Bare repos at `~/.skilltree/cache/{host}/{owner}/{repo}/`. `git fetch` to update, checkout needed tag. Optional -- without it, clones fresh each time.

## Scope

skilltree manages **raw skills, agents, and slash commands** (SKILL.md files plus single-file `.md` agents and commands). It does NOT manage Claude Code plugins, MCP servers, or act as a marketplace.

Plugins coexist without conflict (different namespaces, different storage). For production Docker images, raw skills are the correct primitive.

## Implementation Phases

### Phase 1: Foundation
- Project setup (TypeScript, Bun, CI)
- `skilltree.yml` parser/validator (deps, dev-deps, local, sources, name aliasing)
- `skilltree init`, `skilltree add`
- SKILL.md frontmatter parser

### Phase 2: Git + Resolution
- Git operations with bare repo caching
- Tag listing, semver resolution, constraint intersection
- Dependency graph with composite keys + growing resolution context
- Topological sort (Kahn's), cycle detection, chain health, type constraints
- `skilltree.lock` generation

### Phase 3: Installation
- `skilltree install` (lockfile-first for remote, always-fresh for local)
- `--prod`, `--frozen`, `--force`, `--install-path`
- Symlinks (local dev) vs copies (remote + prod)
- Integrity hashing, modification check, `skilltree verify`

### Phase 4: Lifecycle
- `skilltree update`, `skilltree remove` (with orphan cleanup)
- `skilltree deps tree`, `skilltree list`, `skilltree cache clean`

### Phase 5: Dependency Scanner
- `skilltree scan` (regex), `--check`, `--apply`, `--llm`, `--json`
- Pre-commit hook integration

### Phase 6: Distribution
- npm publish (`npx skilltree`), Bun compile (standalone binary), GitHub releases

### Phase 7: Registries and Discovery
- `~/.skilltree/config.yaml` global config, registry cache management
- `skilltree registry add|remove|list|update`
- `skilltree search`, `skilltree info`
- `skillkit-index.yaml` parsing + dynamic scanning fallback
- `skilltree index` (authoring command for index generation)
- Registry-assisted `skilltree add <name>` (without `--repo`)
- See [registries.md](registries.md) for full spec

### Phase 8: Vendor Mode
- `skilltree vendor` and `skilltree unvendor` commands
- `vendor: true/false` manifest field
- Copy all deps (no symlinks) to `dev_install_path`, toggle `.gitignore`
- `install` guard when vendor mode active
- `verify` gains `STALE` status for outdated vendored local deps
- See [vendor.md](vendor.md) for full spec

### Phase 9: Global Dependencies
- `~/.skilltree/global.yaml` + `~/.skilltree/global.lock`
- `--global` flag on `init`, `add`, `install`, `update`, `remove`, `list`, `verify`, `deps tree`
- Local sources: `sources:` accepting filesystem paths (both global and project manifests)
- Same-origin resolution for local sources (extends same-repo to local directories)
- `--discover` flag on `add` for bulk entity discovery
- See [global.md](global.md) for full spec

## Further Reading

- [reference.md](reference.md) -- File format schemas, resolution algorithm details, error messages
- [registries.md](registries.md) -- Discovery and search: registries, `skilltree search`, registry-assisted `add`
- [vendor.md](vendor.md) -- Vendor mode: commit deps to git for distribution without upstream access
- [global.md](global.md) -- Global dependencies: `--global` flag, local sources, `~/.claude/` install target
- [decisions.md](decisions.md) -- All design decisions (resolved + deferred), open questions, future extensions
- [background.md](background.md) -- Why skilltree exists, comparison to alternatives, aipm lessons
