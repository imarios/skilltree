---
name: skilltree
description: Use the skilltree CLI to manage AI agent skill and agent dependencies. IMPORTANT — before adding, editing, or removing any skill or agent file, check if the project has a skilltree.yml (skilltree-managed). If it does, use skilltree commands and only modify local skills in their origin repo, never installed artifacts.
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
- Managing install targets across coding agents (`skilltree targets`)

## Reference Routing Table

| Need | Read |
|------|------|
| Command syntax and flags | `references/commands.md` |
| Step-by-step tasks (install, upgrade, Docker, global, vendor, multi-agent) | `references/workflows.md` |

## Key Concepts

**Manifest (`skilltree.yml`)** — Declares what you want: repo URLs, version constraints, local paths, and install targets. Two groups: `dependencies` (production) and `dev-dependencies` (local only).

**Lockfile (`skilltree.lock`)** — Records what you got: resolved versions, exact commit SHAs, integrity hashes. Checked into git for reproducibility.

**Remote dependency** — Fetched from a git repo at a semver-pinned version. Cached at `~/.skilltree/cache/`.

**Local dependency** — Symlinked from a co-located path (e.g., `./skills/my-skill`). Edits reflected instantly, no reinstall loop.

**Source shorthand** — The `sources:` map aliases repo URLs or local filesystem paths. Remote sources expand to `repo:`, local sources (starting with `~/`, `/`, `./`) expand to `local:`. Deps from the same local source share a "same-origin" context for transitive resolution.

**Entity types** — Skills (directory with `SKILL.md`) and agents (single `.md` file). Skills can only depend on skills. Agents can depend on both.

**Registries** — Git repos registered globally (`~/.skilltree/config.yaml`) for skill discovery. Registries are authoring-time tools — they help find and add skills via `skilltree search` but are never in the install or resolution path. The manifest stays self-contained.

## Origin-Manifest Resolution — Concepts Every Author and Consumer Should Know

When a repo ships a `skilltree.yml`, it becomes **self-describing**: downstream consumers (and skilltree itself) use that manifest as the authoritative map of what skills/agents the repo owns and where they live. This has concrete consequences:

**If you consume from a repo that has a `skilltree.yml`:**
- You can omit `path:` on direct deps. Origin's manifest supplies it.
  ```yaml
  dependencies:
    task-builder:
      repo: github.com/org/analysi-backend
      # no path: — skilltree reads origin's skilltree.yml and fills it in
  ```
- If you *do* declare `path:` and it matches origin's declared path, skilltree warns "you can omit this." If it differs, you'll see an override warning suggesting `force_path: true` to silence it for intentional forks.
- Transitive deps resolve automatically, even when the origin repo organizes skills at unconventional paths (e.g., `skills/source/<name>/`).
- Cross-repo transitive deps work too: if origin's manifest references a third-party repo, skilltree clones and resolves it on demand (respecting origin's version constraint).

**If you publish a repo that others will use as a skill source:**
- Your `skilltree.yml` is part of your **public contract**. Changes to `dependencies:` affect downstream consumers.
- Skills declared under `dev-dependencies:` stay private — they will never be exposed to downstream consumers. A consumer transitively needing a dev-dep gets a clear error pointing you, the upstream author, as the fix site.
- If you reorganize paths (e.g., move `skills/foo/` → `skills/src/foo/`) at a new tag, consumers pinning the old tag are unaffected; consumers pinning `*` or branches pick up the change via the lockfile.
- Name conflicts between skills you own and skills you transitively expose: the consumer's manifest always wins over origin's manifest (tier 2 beats tier 4).

**When origin's manifest doesn't apply:**
- Origin has no `skilltree.yml` → skilltree falls back to conventional paths (`skills/<name>/SKILL.md`, `agents/<name>.md`, `<name>/SKILL.md` at repo root). Old-school repos keep working with zero manifest authoring.
- Origin's `skilltree.yml` is malformed or doesn't declare the requested name → same fall-through.
- Origin's entry uses a `local:` path that's actually an absolute path on the author's machine (via a `source:` alias expanding to a filesystem path) → skipped silently; consumer gets the conventional probe.

**Quick mental model:** a repo with `skilltree.yml` is richer than one without. The manifest acts as an internal directory: "here's every skill I own, here's where each one lives, here's any third-party dep any of them needs." Consumers inherit that directory.

## Install Targets (Multi-Agent)

skilltree supports multiple coding agents. The `install_targets` field in `skilltree.yml` controls where skills are installed:

```yaml
install_targets:
  - claude    # → .claude/
  - codex     # → .codex/
```

Known agents: `claude`, `codex`, `cursor`, `copilot`, `gemini`, `windsurf`. Custom paths use `./` prefix (e.g., `./my-agent`).

Manage targets with `skilltree targets {list,add,remove,detect,migrate}`. When absent, `install_targets` defaults to `[claude]`.

## Global vs Project vs Vendor

Three scopes, fully independent:

| Need | Mechanism | Install target | Committed to git |
|------|-----------|---------------|-----------------|
| Project needs a skill | `skilltree.yml` | Per `install_targets` | No (gitignored) |
| You want a skill everywhere | `~/.skilltree/global.yaml` | Per detected agents | No (personal) |
| Ship skills without upstream access | `skilltree vendor` | Single target | Yes (committed) |

**Global deps are a personal convenience, not a project dependency.** If the project *requires* a skill, put it in `skilltree.yml`. Global is for "I always want this available" — teammates don't need your global deps.

**Vendor mode is for distribution.** Copies all resolved deps as real files (no symlinks), removes them from `.gitignore`, and sets `vendor: true`. Consumers `git clone` and it works — no `skilltree install`, no upstream access needed. Vendor operates on a single target; use `--target` when multiple are configured. Fully reversible with `skilltree unvendor`.

When the same skill exists in both project and global scope, **project wins** (the agent's built-in shadowing).

## CRITICAL: Installed files are read-only

Files under `.claude/skills/` and `.claude/agents/` are installed artifacts — like `node_modules/`. They are:
- **Gitignored** — never checked into source control
- **Read-only** (chmod 444) — do not edit them in place
- **Recreatable** — `skilltree install` restores them from the lockfile

To modify a skill: edit the source (in the skill's repo or local `skills/` directory), bump the version tag, then `skilltree update`.

## CRITICAL: Modifying skills and agents

Before modifying any skill or agent, check if the project uses skilltree (`skilltree.yml` exists in the repo). If it does:
- **Only modify local skills/agents** defined in the current repo (listed with `local:` in `skilltree.yml`)
- **Never modify installed (remote) skills** — they are managed artifacts from other repos
- **To change a remote skill**, go to that skill's origin repo and modify it there
- If you are unsure whether a skill is local or remote, check `skilltree.yml` or run `skilltree list`

## Environment

skilltree delegates git authentication to the system. SSH keys, credential helpers, and `GITHUB_TOKEN` all work.

For `skilltree scan --llm`, set `ANTHROPIC_API_KEY`.
