# Background: Why skilltree

## The problem

AI coding agent skills (SKILL.md) and agents (.md) are standard across Claude Code, Cursor, Codex, Copilot, and Gemini CLI. The SKILL.md open standard has been adopted by 16+ tools. Skills are distributed via GitHub repos, installed with tools like `npx skills add`.

That works for leaf skills -- standalone skills with no dependencies. Install `python-coding`, use it, done.

But real-world skill ecosystems develop dependency graphs. A `code-review` skill depends on `testing`, `linting`, and `language-support`. A `ci-pipeline` skill depends on `code-review`. An agent depends on 5 skills across 3 repos. These dependencies are declared in frontmatter (`dependencies: [testing, linting]`) but **no existing tool resolves them.**

In production skill ecosystems, the dependency graph can reach:

- 40+ entities (skills + agents) across multiple git repos
- Cross-repo transitive dependencies (skill in repo A depends on skill in repo B, which depends on skill in repo C)
- Same-name collisions (a skill and an agent both named `workflow-builder`)
- Dev-only skills for Claude Code local coding that must not ship in production Docker images
- Production skills served via Claude Code SDK that must be version-pinned and reproducible

## What about existing tools?

**`npx skills add` / `npx add-skill`**: Installs individual skills from GitHub repos. No transitive dependency resolution. If `code-review` depends on 4 other skills, you must know and install each one manually. No version pinning, no lockfile, no dev/prod separation. Works for leaf skills, breaks when skills depend on other skills.

**Git submodules / subtrees**: Pin skill repos to a commit. But submodules are painful, there's no partial checkout (you get the whole repo, not one skill), no transitive resolution, and Claude Code doesn't discover skills in nested submodule paths.

**A Makefile with `git archive`**: Works for 3-4 skills. At 20+ skills across multiple repos, the Makefile becomes the dependency manager -- except it has no transitive resolution, no constraint satisfaction, no lockfile, and every transitive dep must be listed manually.

**Claude Code plugins**: Handle distribution and namespacing, but plugins have no inter-plugin dependency mechanism. `plugin.json` has no `dependencies` field.

**aipm** (the predecessor): Has transitive dependency resolution (Kahn's algorithm, proven with 50+ tests). But requires a running Python API server, Docker container, SQLite database, and OpenAPI codegen pipeline -- all to manage markdown files. The architecture was built before the ecosystem standardized on git repos and SKILL.md.

## Why not stitch tools together?

Could we decompose this into separate tools -- a scanner, a resolver, an installer, a lockfile manager -- and pipe them together?

The value is in the **integration between these steps**, not in any single step:

- The resolver needs the scanner's output (frontmatter deps) to discover transitive deps
- The scanner needs the resolver's state (resolution context) to know which deps are already resolved
- The installer needs the resolver's topological sort to install in the right order
- The lockfile needs all three to record the complete resolved state
- The dev/prod split cuts across all four steps

This is the same argument that justified npm over "wget + tar + a Makefile" -- the individual operations are simple; the integration is the product.

## When you DON'T need skilltree

- **Leaf skills with no dependencies**: `npx skills add` is simpler
- **One-off skill installation**: Manually copying a SKILL.md directory works
- **Exploration and discovery**: SkillsMP, skills.sh, plugin directory are better

## When you DO need skilltree

- **Skills that depend on other skills**, especially across repos
- **Teams** that need reproducible skill environments (lockfile)
- **Dev + prod split** where some skills are for coding assistance and others ship in Docker
- **Co-located skill development** where you iterate on a skill alongside the code it teaches
- **Version pinning** when you need to control which skill versions are used

## Lessons from aipm

skilltree is a successor to aipm, a Rust CLI + Python API package manager for AI agent skills. What carries forward:

| aipm Feature | skilltree Equivalent |
|---|---|
| Kahn's algorithm topological sort | `core/graph.ts` -- deterministic install ordering, proven with 500+ tests |
| Composite keys (`type:name`) | Dependency graph internals -- skill and agent can share a name |
| Regex dependency detection patterns | `skilltree scan` -- 6 battle-tested patterns |
| LLM verification of regex findings | `skilltree scan --llm` -- two-phase extract + verify |
| Dependency validation rules | Missing deps, broken chains, cycles all block install |
| Self-reference filtering | Skill mentioning itself in body text is not a dependency |
| Type constraints | Skills depend on skills only; agents depend on both |
| Content integrity hashing | `skilltree verify` |
| Dependents check on delete | `skilltree remove` warns if others depend on target |
| Repository URL normalization | SSH and HTTPS resolve to same identity |

What was dropped: SQLite database, Python FastAPI server, Docker container, OpenAPI codegen, Rust+Python split, LLM in the install path, custom entity storage format, no version pinning.
