---
name: skilltree
description: Use the skilltree CLI to manage AI agent skill and agent dependencies. IMPORTANT — before adding, editing, or removing any skill or agent file, check if the project has a skilltree.yaml (skilltree-managed). If it does, use skilltree commands and only modify local skills in their origin repo, never installed artifacts.
---

# skilltree — Dependency Manager for AI Agent Skills

Use this skill when:
- Running skilltree commands (`skilltree install`, `skilltree add`, etc.)
- Setting up a new project with skill dependencies
- Discovering skills across git repositories (`skilltree registry`, `skilltree search`)
- Troubleshooting dependency resolution or installation issues
- Managing skill versions and lockfiles
- Scanning skills for undeclared dependencies
- Setting up global dependencies (`skilltree install --global`)
- Vendoring skills for distribution (`skilltree vendor`)

## Reference Routing Table

| Need | Read |
|------|------|
| Command syntax and flags | `references/commands.md` |
| Step-by-step tasks (install, upgrade, Docker, global, vendor) | `references/workflows.md` |

## Key Concepts

**Manifest (`skilltree.yaml`)** — Declares what you want: repo URLs, version constraints, local paths. Two groups: `dependencies` (production) and `dev-dependencies` (local only).

**Lockfile (`skilltree.lock`)** — Records what you got: resolved versions, exact commit SHAs, integrity hashes. Checked into git for reproducibility.

**Remote dependency** — Fetched from a git repo at a semver-pinned version. Cached at `~/.skilltree/cache/`.

**Local dependency** — Symlinked from a co-located path (e.g., `./skills/my-skill`). Edits reflected instantly, no reinstall loop.

**Source shorthand** — The `sources:` map aliases repo URLs or local filesystem paths. Remote sources expand to `repo:`, local sources (starting with `~/`, `/`, `./`) expand to `local:`. Deps from the same local source share a "same-origin" context for transitive resolution.

**Entity types** — Skills (directory with `SKILL.md`) and agents (single `.md` file). Skills can only depend on skills. Agents can depend on both.

**Registries** — Git repos registered globally (`~/.skilltree/config.yaml`) for skill discovery. Registries are authoring-time tools — they help find and add skills via `skilltree search` but are never in the install or resolution path. The manifest stays self-contained.

## Global vs Project vs Vendor

Three scopes, fully independent:

| Need | Mechanism | Install target | Committed to git |
|------|-----------|---------------|-----------------|
| Project needs a skill | `skilltree.yaml` | `.claude/` | No (gitignored) |
| You want a skill everywhere | `~/.skilltree/global.yaml` | `~/.claude/` | No (personal) |
| Ship skills without upstream access | `skilltree vendor` | `.claude/` | Yes (committed) |

**Global deps are a personal convenience, not a project dependency.** If the project *requires* a skill, put it in `skilltree.yaml`. Global is for "I always want this available" — teammates don't need your global deps.

**Vendor mode is for distribution.** Copies all resolved deps as real files (no symlinks) into `.claude/`, removes them from `.gitignore`, and sets `vendor: true`. Consumers `git clone` and it works — no `skilltree install`, no upstream access needed. Fully reversible with `skilltree unvendor`.

When the same skill exists in both project and global scope, **project wins** (Claude Code's built-in shadowing: `.claude/` > `~/.claude/`).

## CRITICAL: Installed files are read-only

Files under `.claude/skills/` and `.claude/agents/` are installed artifacts — like `node_modules/`. They are:
- **Gitignored** — never checked into source control
- **Read-only** (chmod 444) — do not edit them in place
- **Recreatable** — `skilltree install` restores them from the lockfile

To modify a skill: edit the source (in the skill's repo or local `skills/` directory), bump the version tag, then `skilltree update`.

## CRITICAL: Modifying skills and agents

Before modifying any skill or agent, check if the project uses skilltree (`skilltree.yaml` exists in the repo). If it does:
- **Only modify local skills/agents** defined in the current repo (listed with `local:` in `skilltree.yaml`)
- **Never modify installed (remote) skills** — they are managed artifacts from other repos
- **To change a remote skill**, go to that skill's origin repo and modify it there
- If you are unsure whether a skill is local or remote, check `skilltree.yaml` or run `skilltree list`

## Environment

skilltree delegates git authentication to the system. SSH keys, credential helpers, and `GITHUB_TOKEN` all work.

For `skilltree scan --llm`, set `ANTHROPIC_API_KEY`.
