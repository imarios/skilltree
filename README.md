# skilltree

[![CI](https://github.com/imarios/skilltree/actions/workflows/ci.yml/badge.svg)](https://github.com/imarios/skilltree/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/imarios/skilltree/graph/badge.svg)](https://codecov.io/gh/imarios/skilltree)
[![npm](https://img.shields.io/npm/v/skilltree-pm)](https://www.npmjs.com/package/skilltree-pm)
[![license](https://img.shields.io/npm/l/skilltree-pm)](https://github.com/imarios/skilltree/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/skilltree-pm)](https://nodejs.org)

Dependency manager for AI agent skills, agents, and slash commands. Uses git repos as the registry, resolves transitive dependencies, supports semver version pinning via git tags, and produces lockfiles for reproducible installs.

[![demo](https://imarios.github.io/skilltree/demo.gif)](https://imarios.github.io/skilltree/demo.mp4)

## Why skilltree?

AI agent skills ([SKILL.md](https://agentskills.io/specification)) are the open standard for giving coding agents reusable instructions. Existing tools treat skills as independent files — copy to a directory, done. But real-world skill ecosystems develop dependency graphs: a `code-review` skill depends on `testing`, `linting`, and `language-support`. An agent depends on 5 skills spread across 3 repos.

skilltree is `npm` for skills: declare what you need in `skilltree.yml`, run `skilltree install`, and get a resolved, version-pinned, reproducible dependency tree in `skilltree.lock`.

### How it compares

|                                    | skilltree                        | CC plugins          | npx skills | Microsoft APM    | skillpm          |
|------------------------------------|----------------------------------|---------------------|------------|------------------|------------------|
| Transitive dependency resolution   | Yes                              | No                  | No         | Yes              | Yes (via npm)    |
| Semver range constraints (`^2.0.0`)| Yes                              | No (git refs only)  | No         | No (explicit refs)| Yes (via npm)   |
| Lockfile                           | Yes                              | No                  | Partial    | Yes              | Yes (via npm)    |
| Registry / discovery               | Yes (git repos)                  | Yes (git repos)     | No         | No               | Yes (npmjs.org)  |
| Git-native (no registry server)    | Yes                              | Yes                 | Yes        | Yes              | No (npmjs.org)   |
| Multi-agent support                | Yes (Claude, Codex, Cursor, ...) | No (Claude Code only)| No        | No               | No               |
| Single binary, zero infrastructure | Yes                              | Built-in            | N/A        | No (Python/pip)  | No (Node.js/npm) |

## Install

```bash
# npm / npx (no install needed)
npx skilltree-pm

# Or install globally
npm install -g skilltree-pm

# Or with Bun
bun install -g skilltree-pm
```

> **Note:** The npm package is `skilltree-pm`, but the command is `skilltree`.

## Quick Start

```bash
# Initialize a project
skilltree init

# Seed popular community registries
skilltree registry init

# Search and add from registries
skilltree search python
skilltree add python-coding

# Or add explicitly
skilltree add code-review --repo github.com/org/skills --path skills/code-review --version "^2.0.0"
skilltree add my-style --local ./skills/my-style

# Slash commands (Claude Code) — installed to .claude/commands/
skilltree add review --repo github.com/org/cmds --path commands/review.md --type command

# Resolve and install
skilltree install
```

## Key Features

### Transitive Dependencies & Lockfile

Two files manage all state:

- **`skilltree.yml`** — what you want (repo URLs, version constraints, local paths)
- **`skilltree.lock`** — what you got (resolved versions, exact commits, integrity hashes)

Skills declare their own dependencies in SKILL.md frontmatter. skilltree resolves the full transitive graph, pins versions via git tags, and installs in topological order. Teammates get identical versions from the lockfile.

```yaml
# skilltree.yml
dependencies:
  code-review:
    repo: github.com/org/skills
    path: skills/code-review
    version: "^2.0.0"
```

```markdown
<!-- skills/code-review/SKILL.md -->
---
name: code-review
dependencies:
  - testing
  - linting
---
```

skilltree resolves `code-review`, discovers it needs `testing` and `linting`, resolves those too, and installs all three.

**Origin-manifest resolution.** When the upstream repo ships its own `skilltree.yml`, skilltree uses it as the authoritative map of what lives where. Two consequences for consumers:

- **`path:` is optional.** If origin declares the name, skilltree fills in the path at install time.
  ```yaml
  dependencies:
    task-builder:
      repo: github.com/org/some-repo
      # path: inferred from origin's skilltree.yml
  ```
- **Unconventional layouts still work.** Transitive deps resolve even when the upstream repo organizes skills at non-standard paths like `skills/source/<name>/`. Cross-repo transitive deps (where origin's manifest references a third-party repo) are cloned on demand.

When consumers declare a `path:` that duplicates or overrides origin's declaration, skilltree emits a warning. Set `force_path: true` to silence warnings on intentional overrides.

Repos without a manifest still work via the conventional `skills/<name>/` layout — origin-manifest resolution is opt-in from the author's side.

### Local Dependencies

For skill authors iterating on a skill alongside the code it teaches. Local deps are **symlinked** — edits reflected instantly, no reinstall loop:

```bash
skilltree add my-style --local ./skills/my-style
skilltree install    # symlinks .claude/skills/my-style → ./skills/my-style
```

### Publication Surface — `publish:` and `exclude:`

When your repo is also a registry (other people install skills from it), `skilltree.yml` doubles as your **publication surface**: it tells the world which entities you offer and what's part of each one.

```yaml
dependencies:
  python-coding:
    local: ./skills/python-coding
    type: skill
    exclude:                       # trim noise from what consumers receive
      - "experiments/"
      - "*.scratch.md"

  experimental-refactor:
    local: ./skills/experimental-refactor
    type: skill
    publish: false                 # WIP — installs locally but hidden from consumers
```

- **`publish: false`** marks a local entity as not-ready-to-share. It still installs into your own `.claude/` (so you can dogfood it), but registry search, `vendor`, and any downstream `skilltree install` that would otherwise resolve it through your manifest skip it. The flag is only valid on local entries.
- **`exclude:`** trims files from the entity when consumers install or vendor it. Gitignore-style globs, relative to the entity root.
- **`.skilltreeignore`** (repo root): gitignore-style patterns that apply to every published entity. Useful for cross-cutting noise (`.DS_Store`, `*.log`).

Run `skilltree check` to catch the asymmetric-publish footgun: a published entity that transitively depends on a `publish: false` same-repo entity will install fine for you but fail for consumers. The check reports the chain so the fix is obvious. `check` also lints the frontmatter of every local `SKILL.md` / agent / command — missing `name:`, missing `description:`, invalid semver in `version:`, or a malformed `skills:` block become warnings (and exit 1 under `--strict`).

This is **authoring intent, not access control** — anyone with git access to your repo can read every file regardless of these flags. They're about what your repo *offers*, not what it *protects*.

### Global Dependencies

Skills you want available in every project without adding them to each `skilltree.yml`.

```bash
skilltree init --global
skilltree add --global python-coding --repo github.com/org/skills --path skills/python-coding
skilltree install --global    # installs to ~/.claude/
```

Global deps install to `~/.claude/` and are always shadowed by project deps in `.claude/`. They use local sources to avoid repeating paths:

```yaml
# ~/.skilltree/global.yaml
sources:
  mine: ~/Projects/my-skills

dependencies:
  python-coding:
    source: mine
    path: skills/python-coding
  general-coding:
    source: mine
    path: skills/general-coding
```

Bulk-add everything from a source directory:

```bash
skilltree add --global --source mine --discover
```

**When to use global:** Personal productivity skills you want everywhere — `python-coding`, `general-coding`, `my-style`. If the *project* needs a skill, put it in the project's `skilltree.yml` — that's the contract teammates and CI rely on.

### Vendor Mode

Ship skills to consumers who don't have access to your upstream repos. Vendor copies all resolved deps into `.claude/` as committed files — `git clone` is all they need.

```bash
# Maintainer: enter vendor mode
skilltree vendor                # copies all deps to .claude/, removes from .gitignore
git add .claude/ skilltree.yml
git commit -m "vendor skills"

# Consumer: just clone
git clone bootstrap-repo && cd bootstrap-repo
# Skills are already in .claude/. No skilltree install needed.

# Maintainer: update vendored deps
skilltree update python-coding
skilltree vendor                # re-copies with new versions
git add . && git commit -m "bump python-coding"

# Exit vendor mode when consumers get upstream access
skilltree unvendor
skilltree install               # back to normal (symlinks + gitignored)
```

**When to use vendor:** You publish a template/bootstrap repo and consumers can't (or shouldn't need to) access the source repos. Vendor is a distribution mechanism — the maintainer manages deps normally, then snapshots them for distribution.

### Registries & Discovery

Registries are git repos that contain skills. Register them once, then search and add by name:

```bash
skilltree registry init                        # seed community registries
skilltree registry add github.com/org/skills   # add your own

skilltree search python                        # search across all registries
skilltree info python-coding                   # detailed info
skilltree add python-coding                    # resolves repo + path from registry
```

Registries are authoring-time tools — they help you find and add skills. They are never in the install path. `skilltree.yml` always records explicit `repo:` + `path:`, so teammates don't need the same registries configured.

### Dev/Prod Separation

Some skills help developers write code; others power AI features at runtime. When your product ships skills, set `src_install_path` to separate them:

```yaml
src_install_path: src/skills       # for the application runtime

dependencies:                      # installed to BOTH .claude/ and src/skills/
  code-review:
    repo: github.com/org/skills
    path: skills/code-review
    version: "^2.0.0"

dev-dependencies:                  # installed to .claude/ ONLY
  python-coding:
    repo: github.com/org/skills
    path: skills/python-coding
    version: "^2.0.0"
```

```bash
skilltree install --prod --frozen   # CI: prod deps only, lockfile-only, no resolution
```

### Multi-Agent Support

Skills work across Claude Code, Codex, Cursor, Copilot, Gemini CLI, and Windsurf. Install to multiple agents at once:

```yaml
install_targets:
  - claude
  - codex
```

```bash
skilltree install                       # installs to both .claude/ and .codex/
skilltree targets list                  # see detected and configured agents
skilltree targets add cursor            # add another agent (then `skilltree install`)
skilltree targets detect                # auto-detect installed agents
skilltree init --target claude --target codex   # opt in at init time, skip detection
```

By default `init` enrols only Claude Code if multiple agents are detected — interactive runs get a prompt to include the rest; CI/non-interactive runs stay on the safe `[claude]` default. Use `--target` (repeatable) or `--yes` to enrol others up front, or `skilltree targets add <agent>` / `skilltree targets detect` later.

Migrating from `dev_install_path`? Run `skilltree targets migrate`.

### Dependency Scanning

Skills often reference other skills in their body text — "Use the `testing` skill for coverage checks." AI agents like Claude Code or Codex can resolve these references at runtime from whatever skills happen to be installed. But when you share your project, those skills may not be there. A teammate clones the repo and the references point to nothing.

`skilltree scan` catches these implicit references and surfaces them so you can explicitly declare them in frontmatter for skilltree to manage. For repos that publish skills for others, use `--check` in a pre-commit hook to catch missing dependencies before they're committed:

```bash
skilltree scan ./skills/                # regex detection
skilltree scan --llm ./skills/          # + LLM semantic detection
skilltree scan --check ./skills/        # pre-commit mode (exit 1 if gaps found)
skilltree scan --apply ./skills/        # auto-update frontmatter
```

```yaml
# .pre-commit-config.yaml
- repo: local
  hooks:
    - id: skilltree-scan
      name: Check skill dependencies
      entry: skilltree scan --check
      language: system
      files: '(^skills/.*\.md$|^agents/.*\.md$)'
      pass_filenames: true
```

## When to Use What

| Need | Mechanism | Who benefits |
|------|-----------|--------------|
| Project needs a skill | `skilltree.yml` dependency | Everyone on the team |
| You want a skill everywhere | `skilltree add --global` | Just you |
| Ship skills without upstream access | `skilltree vendor` | Consumers of your repo |
| Find skills by name | `skilltree search` via registries | Skill discovery |

## Commands

| Command | Description |
|---------|-------------|
| `skilltree init` | Create `skilltree.yml` and update `.gitignore` |
| `skilltree add <name>` | Add a dependency (remote, local, or dev) |
| `skilltree install` | Resolve dependencies and install |
| `skilltree update [name]` | Update to latest versions |
| `skilltree outdated [name]` | Preview which deps have newer versions (read-only) |
| `skilltree remove <name>` | Remove a dependency |
| `skilltree verify` | Check installed files against lockfile |
| `skilltree list` | List installed dependencies |
| `skilltree deps tree` | Show dependency tree |
| `skilltree why <name>` | Reverse-lookup which top-level dep pulled in `<name>` |
| `skilltree scan <paths...>` | Detect undeclared deps in skill body text |
| `skilltree vendor` | Enter vendor mode (copy deps, commit to git) |
| `skilltree unvendor` | Exit vendor mode (restore symlinks + gitignore) |
| `skilltree teach` | Install the skilltree skill to all detected coding agents |
| `skilltree targets list` | Show detected and configured coding agents |
| `skilltree targets add <target>` | Add an agent or path to install targets |
| `skilltree targets remove <target>` | Remove an agent or path from install targets |
| `skilltree targets detect` | Auto-detect agents and add missing ones |
| `skilltree targets migrate` | Convert `dev_install_path` to `install_targets` |
| `skilltree search <query>` | Search registries for skills and agents |
| `skilltree info <name>` | Show detailed info about a skill or agent |
| `skilltree registry init` | Seed popular community registries |
| `skilltree registry add <url>` | Register a git repo for skill discovery |
| `skilltree registry remove <name>` | Remove a registered registry |
| `skilltree registry list` | List registered registries |
| `skilltree registry update [name]` | Fetch repos and rebuild search indexes |
| `skilltree registry index` | Generate `skilltree-index.yml` for a skill repo |
| `skilltree completion [shell]` | Output shell completion script (zsh/bash) |
| `skilltree cache clean` | Remove cached repositories |

### Key Flags

| Flag | Commands | Description |
|------|----------|-------------|
| `--global` | init, add, install, update, remove, list, verify, deps tree, why | Operate on global deps (`~/.skilltree/global.yaml` → `~/.claude/`) |
| `--prod` | install | Skip dev-dependencies |
| `--frozen` | install, vendor | Lockfile-only, error if out of sync (CI mode) |
| `--force` | install, remove | Overwrite modified files / skip confirmation |
| `--dry-run` | install, update, vendor | Preview without applying |
| `--install-path <path>` | install | Override install directory (copies instead of symlinks) |
| `--dev` | add | Add as dev dependency |
| `--local <path>` | add | Add a local (symlinked) dependency |
| `--discover` | add | Bulk-discover entities from a source directory |
| `--llm` | scan | Use LLM for semantic dependency detection |
| `--check` | scan | Exit 1 if undeclared deps found (pre-commit mode) |
| `--apply` | scan | Auto-update frontmatter with detected deps |

## Development

```bash
bun install            # Install dependencies
pre-commit install     # Install pre-commit hooks
pre-commit install --hook-type post-merge  # Auto-rebuild after version bumps
bun test               # Run tests
bun run lint           # Biome linter
bun run typecheck      # TypeScript strict mode
bun run format         # Auto-format

# Build standalone binary
bun build --compile src/cli.ts --outfile dist/skilltree
```

## License

MIT
