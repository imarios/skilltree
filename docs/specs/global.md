# Global Dependencies

**Version**: 1.1 (draft)
**Date**: 2026-04-02

Global deps install once, available in every project. Project-scoped deps remain the default and the only mechanism that affects reproducibility.

## The Problem

A developer has skills they want everywhere — `python-coding`, `general-coding`, `my-style`. Today they either:
1. Add them to every project's `skilltree.yml` (duplication)
2. Manually copy/symlink into `~/.claude/skills/` (unmanaged)

Both break down. Option 1 means 15+ identical entries across 20 projects. Option 2 means no version tracking, no transitive resolution, no lockfile.

## Design Principle

**Global deps are a personal convenience, never a project dependency.**

If a project needs a skill, it goes in `skilltree.yml`. Global is "I always want this available." Teammates don't need your global deps — the project's `skilltree.yml` is self-contained.

This follows the npm model: `npm install -g` is for CLI tools you use personally. Project deps go in `package.json`.

## How It Works

### Two scopes, fully independent

| | Project | Global |
|---|---|---|
| Manifest | `./skilltree.yml` | `~/.skilltree/global.yaml` |
| Lockfile | `./skilltree.lock` | `~/.skilltree/global.lock` |
| Install path | `.claude/` (or `src_install_path`) | `~/.claude/` |
| Checked into git | Yes | No (personal) |
| Resolution | Independent | Independent |
| Has `dev-dependencies` | Yes | No (all global deps are "dev" by nature) |
| `--prod` / `src_install_path` | Yes | No (no prod concept for global) |

Project and global never cross-resolve. A skill in the global manifest cannot satisfy a transitive dep in a project manifest, and vice versa. They are two separate dependency graphs.

### Precedence (Claude Code behavior)

When the same skill exists in both scopes, **project wins**. This is how Claude Code already works — `.claude/skills/` shadows `~/.claude/skills/`. skilltree doesn't need to implement this; it's the runtime's responsibility.

### Global manifest format

```yaml
# ~/.skilltree/global.yaml
sources:
  org: github.com/org/shared-skills
  mine: ~/Projects/my-skills             # local source (see below)

dependencies:
  # Remote dep (same syntax as project)
  code-review:
    source: org
    path: skills/code-review
    version: "^2.0.0"

  # Local dep (absolute or ~-relative path)
  my-style:
    local: ~/Projects/my-skills/skills/my-style

  # Local dep via local source (avoids repeating the base path)
  python-coding:
    source: mine
    path: skills/python-coding
  general-coding:
    source: mine
    path: skills/general-coding
  typescript-coding:
    source: mine
    path: skills/typescript-coding
```

No `dev-dependencies` section. No `dev_install_path` / `src_install_path`. Global is simpler.

## Local Sources

This is the key extension that makes global deps practical. Today, `sources:` maps names to git repo URLs. We extend it to also accept local filesystem paths.

**Scope:** Local sources are a general feature — they work in both global and project manifests. They are most useful in the global context where deps reference repos elsewhere on the machine.

### Detection

A source value is **local** if it starts with `~/`, `/`, or `./`. Otherwise it's a **remote** git URL.

```yaml
sources:
  org: github.com/org/shared-skills      # remote (git URL)
  mine: ~/Projects/my-skills             # local (starts with ~/)
  nearby: ./sibling-repo                 # local (starts with ./)
```

`./` relative paths resolve against the manifest's directory:
- Project manifest: relative to project root
- Global manifest: relative to `~/.skilltree/` (not recommended — prefer `~/` or absolute paths)

### Behavior when source is local

When a dependency uses `source:` that resolves to a local path, it behaves **like `local:`** — symlinked in dev, copied in prod, always re-read from filesystem:

| Aspect | Remote source | Local source |
|---|---|---|
| Resolution | `source` → git URL + `path` | `source` → filesystem path + `path` |
| Equivalent to | `repo:` + `path:` | `local: {source_path}/{path}` |
| Version | Required (or defaults to `*`) | Silently ignored |
| Install action | Copy from git cache | Symlink (dev) / Copy (`--install-path`) |
| Lockfile entry | `version`, `commit`, `integrity` | `source: local`, `commit: HEAD` |
| Re-resolution | Only when manifest changes | Always (re-read from filesystem) |
| Same-origin resolution | Yes (same git repo) | Yes (same local source directory) |

The `source:` + `path:` combination for a local source is syntactic sugar for `local: {expanded_source}/{path}`. They produce identical installation behavior.

This changes the contract of the `source:` field: it previously expanded exclusively to `repo:`. It now expands to either `repo:` or `local:` semantics depending on the value in the `sources:` map. See [reference.md](reference.md) for the updated field description.

### Why this matters for global

A developer maintaining `~/Projects/my-skills/` with 12 skills would need:

**Without local sources (verbose):**
```yaml
dependencies:
  python-coding:
    local: ~/Projects/my-skills/skills/python-coding
  general-coding:
    local: ~/Projects/my-skills/skills/general-coding
  typescript-coding:
    local: ~/Projects/my-skills/skills/typescript-coding
  # ...9 more entries, each repeating the base path
```

**With local sources (DRY):**
```yaml
sources:
  mine: ~/Projects/my-skills

dependencies:
  python-coding:
    source: mine
    path: skills/python-coding
  general-coding:
    source: mine
    path: skills/general-coding
  typescript-coding:
    source: mine
    path: skills/typescript-coding
  # ...9 more entries, but the base path is declared once
```

If `~/Projects/my-skills/` moves to `~/Skills/my-skills/`, update one line in `sources:` and re-run `skilltree install --global`. All symlinks update.

### Local sources in project manifests: reproducibility warning

Local sources also work in project manifests. However, entries with `~/` or absolute paths in a committed `skilltree.yml` create a "works on my machine" problem — teammates with different directory structures will get errors.

**Safe:** `./` relative paths (resolve within the project tree, portable):
```yaml
sources:
  local-skills: ./skills    # relative to project root — portable
```

**Risky if committed:** `~/` or absolute paths (machine-specific):
```yaml
sources:
  team-skills: ~/Projects/team-skills    # only works if teammate has same path
```

For project manifests, prefer `./` relative local sources or standard `local:` with relative paths. Reserve `~/` and absolute paths for the global manifest where they belong.

## Same-Origin Resolution for Local Sources

The main spec defines transitive resolution priority as: manifest → resolution context → same-repo → error. The "same-repo" step looks for a transitive dep in the same git repo as its parent.

Local sources extend this concept. When a dependency comes from a `source:` entry (whether remote or local), its transitive deps can be resolved from the same origin:

| Parent's origin | Same-origin lookup |
|---|---|
| Remote `source:` / `repo:` | Scan the same git repo for the transitive dep |
| Local `source:` | Scan the same local source directory for the transitive dep |
| Standalone `local:` (no source) | **No same-origin** — standalone deps have no sibling context |

### Example

```yaml
# ~/.skilltree/global.yaml
sources:
  mine: ~/Projects/my-skills

dependencies:
  python-coding:
    source: mine
    path: skills/python-coding
```

If `~/Projects/my-skills/skills/python-coding/SKILL.md` declares `dependencies: [testing]`, resolution tries:

1. **Manifest** — is `testing` in `~/.skilltree/global.yaml`? No.
2. **Resolution context** — was `testing` already resolved? No.
3. **Same-origin** — does `testing` exist in the same local source (`~/Projects/my-skills`)? Scan for `skills/testing/SKILL.md` or `agents/testing.md`. **Yes → resolved.**
4. Error — if not found.

The scan heuristic for same-origin in local sources is the same as for git repos: walk the directory tree looking for entities that match the name. An entity matches if its directory name (skills) or filename stem (agents) equals the dependency name.

### Standalone `local:` has no same-origin

```yaml
dependencies:
  my-style:
    local: ~/Projects/my-skills/skills/my-style
```

If `my-style` declares `dependencies: [testing]`, resolution has NO same-origin step — `local:` points to a specific entity, not a source directory. The transitive dep must be resolved from the manifest or resolution context, or it's an error.

This is consistent with project-level `local:` behavior today — standalone local deps don't have a "repo" to scan.

## Symlink Mechanics

### Project-local (today)

```
projectDir = /Users/dev/myproject
entity.path = ./skills/my-style

sourcePath = resolve(projectDir, "./skills/my-style")
           = /Users/dev/myproject/skills/my-style

targetPath = /Users/dev/myproject/.claude/skills/my-style
           → symlink to /Users/dev/myproject/skills/my-style
```

Symlink source and target are in the same project tree. Relative symlinks work.

### Global-local (new)

```
entity.path = ~/Projects/my-skills/skills/python-coding  (expanded from source + path)

sourcePath = /Users/dev/Projects/my-skills/skills/python-coding  (absolute, after ~ expansion)

targetPath = ~/.claude/skills/python-coding
           → symlink to /Users/dev/Projects/my-skills/skills/python-coding
```

Source and target are in **different directory trees**. Symlinks must be **absolute paths** — relative symlinks would break because there's no stable relative relationship between `~/.claude/` and wherever the source repo lives.

### Implementation change

Today (`installer.ts:180`):
```typescript
const sourcePath = resolve(projectDir, entity.path);
```

For global installs, `entity.path` is already absolute (after `~` expansion during manifest parsing). The `resolve()` call still works — `resolve(base, absolutePath)` returns the absolute path unchanged. But the installer needs to know the install base is `~/.claude/` instead of `{projectDir}/.claude/`.

The actual change: the installer receives `installBase` as a parameter (already does via `options.installPath`). For global installs, `installBase = expandTilde("~/.claude")`.

## Global Lockfile Format

The global lockfile at `~/.skilltree/global.lock` uses the **same schema** as the project lockfile, with these specifics:

```yaml
# ~/.skilltree/global.lock -- DO NOT EDIT MANUALLY
# Generated by skilltree v1.0.0
lockfile_version: 1

packages:
  # Remote dep — identical to project lockfile format
  code-review:
    type: skill
    group: prod
    repo: github.com/org/shared-skills
    path: skills/code-review
    version: 2.1.3
    commit: a1b2c3d4e5f6
    integrity: sha256-xxxx
    dependencies: []

  # Local dep (standalone local:)
  my-style:
    type: skill
    group: prod
    source: local
    path: ~/Projects/my-skills/skills/my-style
    commit: HEAD
    dependencies: []

  # Local dep (via local source) — identical lockfile representation
  python-coding:
    type: skill
    group: prod
    source: local
    path: ~/Projects/my-skills/skills/python-coding
    commit: HEAD
    dependencies:
      - testing

  # Transitive dep (discovered via same-origin in local source)
  testing:
    type: skill
    group: prod
    source: local
    path: ~/Projects/my-skills/skills/testing
    commit: HEAD
    dependencies: []
```

### Specifics

**`group` field:** Always `prod`. Global has no `dev-dependencies`, so all entries come from `dependencies` and get `group: prod`. This requires zero schema changes — the field semantics ("from which manifest section") still hold.

**Tilde preservation:** Paths in the lockfile use `~` prefix, not expanded absolute paths. This makes the lockfile portable across machines where the home-relative directory structure is the same. Tilde expansion happens at parse time.

**`source: local` is lossy by design:** Both standalone `local:` deps and local-source deps produce `source: local` in the lockfile. The lockfile loses the distinction between `local: ~/path` and `source: mine` + `path: x`. This is intentional — they produce identical installation behavior. The manifest retains the full information.

**Local dep path format:** Project lockfiles store relative paths (`./skills/my-style`). Global lockfiles store tilde-prefixed paths (`~/Projects/my-skills/skills/my-style`). The parser distinguishes by prefix.

## Commands

All existing commands gain a `--global` flag. When `--global` is set, the command operates on `~/.skilltree/global.yaml` and installs to `~/.claude/`.

### `skilltree init --global`

```bash
$ skilltree init --global
Created ~/.skilltree/global.yaml
```

Creates `~/.skilltree/` directory (if needed) and an empty global manifest. Does NOT touch `.gitignore` (global has no git context).

If `~/.skilltree/global.yaml` already exists: warns and does not overwrite.

```
Warning: ~/.skilltree/global.yaml already exists. No changes made.
```

### `skilltree add --global <name>`

```bash
# Remote
$ skilltree add --global python-coding --source org --path skills/python-coding --version "^2.0.0"

# Remote (registry-assisted, when registries are configured)
$ skilltree add --global python-coding
  Searching registries... found in shared-skills
  Added python-coding from github.com/org/shared-skills

# Local (explicit path)
$ skilltree add --global my-style --local ~/Projects/my-skills/skills/my-style

# Local (via local source)
$ skilltree add --global general-coding --source mine --path skills/general-coding
```

Registry-assisted `add` (without `--repo` or `--source`) works with `--global`. Registries write the full `repo:` + `path:` coordinates to `global.yaml`, keeping the manifest self-contained.

`--local` with `--global` validates the path exists at add-time (fail fast). Tilde paths are stored literally in the manifest, not expanded.

### `skilltree add --global --discover`

```bash
# Discover entities under a local source
$ skilltree add --global --source mine --discover
  Scanning ~/Projects/my-skills...
  Found 12 entities:
    skills/python-coding       (skill)
    skills/general-coding      (skill)
    skills/typescript-coding   (skill)
    agents/code-reviewer.md    (agent)
    ...8 more

  Add all 12 to ~/.skilltree/global.yaml? [Y/n]

# Discover from a path (without a pre-defined source)
$ skilltree add --global --discover ~/Projects/my-skills
  Scanning ~/Projects/my-skills...
  ...
```

`--discover` (named to avoid confusion with `skilltree scan`, which is a different tool for detecting undeclared deps) walks a source directory and finds entities:

- **Skills:** Directories containing `SKILL.md`
- **Agents:** `.md` files with valid YAML frontmatter containing at minimum a `name:` field. Common non-entity files are excluded: `README.md`, `CHANGELOG.md`, `LICENSE.md`, `CONTRIBUTING.md`, and files outside `agents/` or `skills/` directories.

Entities already in the manifest are shown as `(already added)` and skipped. The user confirms before writing. No selective mode in v1 — accept all or abort. Entity selection can be added later if needed.

`--discover` also works in project manifests: `skilltree add --source org --discover` scans a remote source's git repo for entities.

### `skilltree install --global`

```bash
$ skilltree install --global

Resolving dependencies...
  ~/Projects/my-skills (local source):
    python-coding (skill, symlinked)
    general-coding (skill, symlinked)
    testing (skill, transitive, symlinked)
  github.com/org/shared-skills: ^2.0.0 -> v2.1.3
    code-review (skill)

Install order:
  1. skill:testing (local, transitive)
  2. skill:python-coding (local)
  3. skill:general-coding (local)
  4. skill:code-review@2.1.3

Installing 4 entities to ~/.claude/ ... done.
Updated ~/.skilltree/global.lock
```

Creates `~/.skilltree/`, `~/.claude/skills/`, and `~/.claude/agents/` if they don't exist (`mkdir -p`).

**Flags that apply:** `--frozen`, `--force`, `--dry-run`.
**Flags that DON'T apply:** `--prod` (error), `--install-path` (error).

`--frozen` is allowed for consistency. Use case: setup scripts that enforce a known-good global configuration from a dotfiles repo. Uncommon but not prohibited.

**Non-managed files:** `install --global` only manages files tracked in `~/.skilltree/global.lock`. Files manually placed in `~/.claude/skills/` or `~/.claude/agents/` are left untouched. `verify --global` only checks managed entries.

### `skilltree list [--global]`

```bash
$ skilltree list
Name                Type   Group  Version  Source
code-review         skill  prod   2.1.3    github.com/org/skills
my-style            skill  prod   local    ./skills/my-style

Also: 5 global deps installed (skilltree list --global)
```

```bash
$ skilltree list --global
Name                Type   Version  Source
python-coding       skill  local    ~/Projects/my-skills (via mine)
general-coding      skill  local    ~/Projects/my-skills (via mine)
code-review         skill  2.1.3    github.com/org/shared-skills
```

Project `list` shows a one-line footer hinting at global deps (only if global deps exist). Global `list` omits the `Group` column (no dev/prod distinction).

### `skilltree remove --global <name>`

Same behavior as project `remove`: removes from manifest, updates lockfile, deletes installed symlink/files. **Orphaned transitive deps are cleaned up** — entities no longer reachable from a remaining manifest entry are removed (same cascading logic as project remove).

```bash
$ skilltree remove --global python-coding
Removed python-coding from ~/.skilltree/global.yaml
Orphaned transitive dep removed: testing
Updated ~/.skilltree/global.lock
Deleted ~/.claude/skills/python-coding
Deleted ~/.claude/skills/testing
```

### `skilltree scan` — NOT applicable to global

`skilltree scan` is an authoring tool for detecting undeclared dependencies in skill body text. It operates on skill source files, not installed files.

There is no `skilltree scan --global`. If you author skills in `~/Projects/my-skills/`, run `skilltree scan ~/Projects/my-skills/skills/` directly — that's a project-level operation in the authoring repo, not a global operation.

### Other commands

```bash
skilltree update --global            # Update all global remote deps
skilltree update --global code-review  # Update one
skilltree verify --global            # Check symlinks and integrity
skilltree deps tree --global         # Show dependency tree
skilltree cache clean                # Shared cache — no --global variant
```

`cache clean` has no `--global` variant. The git cache at `~/.skilltree/cache/` is shared between project and global installs. Cleaning it affects both.

### No-flag behavior

`skilltree install` (without `--global`) **never** touches global deps. The two scopes are independent. To install both:

```bash
skilltree install && skilltree install --global
```

Or alias it. skilltree does not combine them automatically — that would be surprising.

## Broken Symlinks

Global-local symlinks point to absolute paths outside `~/.claude/`. They break when:

1. **Source repo moves** — `~/Projects/my-skills/` renamed to `~/Skills/shared/`
2. **Source repo deleted** — `rm -rf ~/Projects/my-skills/`
3. **New machine** — paths don't exist yet

### Detection

`skilltree verify --global` checks each symlink target exists:

```bash
$ skilltree verify --global
  python-coding    BROKEN (target ~/Projects/my-skills/skills/python-coding not found)
  general-coding   BROKEN (target ~/Projects/my-skills/skills/general-coding not found)
  code-review      OK
```

### Recovery

1. **Repo moved:** Update `sources:` path in `~/.skilltree/global.yaml`, run `skilltree install --global`.
2. **Repo deleted:** Clone it again, or `skilltree remove --global <name>`.
3. **New machine:** Clone your skills repo, update paths, `skilltree install --global`. Remote deps re-fetch automatically.

### `skilltree install --global` with broken local paths

Errors immediately (same as project-level local deps):

```
Error: Local dependency path not found

  python-coding: ~/Projects/my-skills/skills/python-coding
  Path does not exist.

Fix: Check the source path in ~/.skilltree/global.yaml, or clone the source repo.
```

## Interaction with Project Deps

### No cross-resolution

Global and project manifests are resolved independently. If project `skilltree.yml` has `python-coding` and `~/.skilltree/global.yaml` also has `python-coding`, they resolve separately with potentially different versions.

At runtime, Claude Code loads project's `.claude/skills/python-coding` and ignores global's `~/.claude/skills/python-coding` (project shadows global).

### Working inside the source repo

```
~/Projects/my-skills/          ← you're here, authoring skills
├── skilltree.yml             ← this repo's project-level deps
├── skills/
│   ├── python-coding/SKILL.md ← source skill
│   └── general-coding/SKILL.md
```

This repo has its OWN `skilltree.yml` (project-level deps it needs for development). Those same skills are ALSO referenced in `~/.skilltree/global.yaml`.

Both work independently:
- `skilltree install` → installs this project's deps to `.claude/`
- `skilltree install --global` → symlinks skills to `~/.claude/` (pointing to this repo)

When Claude Code runs here, project `.claude/` takes precedence. The global symlinks exist but are shadowed. No conflict.

## Edge Cases

- **`--global` + `--install-path`:** Error. Global always installs to `~/.claude/`.
- **`--global` + `--prod`:** Error. Global has no prod concept.
- **`--global` + `dev-dependencies` in manifest:** Error at parse time. Global manifest only supports `dependencies`.
- **`sources:` with `./` in global manifest:** Resolves relative to `~/.skilltree/`. Not recommended — prefer `~/` or absolute paths.
- **Two entries resolving to same `(name, type)`:** Error (consistent with Decision #7 in the main spec). No "first-match wins" — duplicate resolution is always an error.
- **`--discover` with mixed types:** Discovers both skills and agents. Each gets its own manifest entry with appropriate `type:`.
- **`--discover` with existing entries:** Entities already in the manifest are shown as `(already added)` and skipped. No duplicates created.
- **Global lockfile merge conflicts:** N/A. `~/.skilltree/global.lock` is not in any git repo.
- **`cache clean` and global:** Same cache (`~/.skilltree/cache/`). No `--global` variant — cleaning affects both scopes.
- **`~/.claude/` contains non-skilltree files:** `install --global` only manages files tracked in the global lockfile. Manually placed skills, Claude Code settings, MCP config — all left untouched. `verify --global` only checks managed entries.
- **`--frozen --global`:** Allowed. Reads global lockfile as sole source of truth. Use case: reproducible setup scripts from a dotfiles repo.
- **Tilde in manifest:** Stored literally as `~`. Never normalized to absolute paths by `add` or any other command. Expanded to `os.homedir()` at parse time only.
- **Transitive dep from standalone `local:` dep:** No same-origin fallback. Must be resolved from manifest or resolution context. Error if unresolvable (with actionable fix message).
- **Transitive dep from local-source dep:** Same-origin resolves by scanning the local source directory for sibling entities.
- **Symlink loops:** If a symlink target contains a symlink back to `~/.claude/`, the loop would be caught by the OS (ELOOP). skilltree does not add explicit loop detection — the OS-level error is sufficient and the scenario requires deliberate misconfiguration.
- **`skilltree install --global` lockfile behavior:** Same as project: lockfile-first for remote deps, always-fresh for local deps. Failed install leaves lockfile unchanged.

## Design Decisions

### 17. Global deps are independent, not inherited

**Decided:** Global and project manifests never cross-resolve. A global skill cannot satisfy a project's transitive dep.

**Why:** Cross-resolution makes project builds depend on the developer's personal setup. Teammate clones the repo → transitive dep missing → "works on my machine." The whole point of `skilltree.yml` + `skilltree.lock` is reproducibility. Global deps must not compromise that.

**Alternative rejected:** "Fall through to global" — if a project transitive dep can't be resolved from the project manifest, check global. Rejected because it makes project installs non-deterministic across machines.

### 18. Local sources extend `sources:` rather than a new concept

**Decided:** `sources:` accepts both git URLs and local filesystem paths. Detection by prefix (`~/`, `/`, `./`).

**Why:** `sources:` already means "where skills come from." A local directory is where skills come from. Adding `local-sources:` as a separate concept doubles the surface area for no conceptual gain.

**Trade-off:** A source's type (remote vs local) is implicit from its value. `source: mine` in a dependency doesn't tell you whether it's local or remote without looking at the `sources:` map. Acceptable because you're reading the same file.

**Contract change:** This changes the behavior of `source:` from "always expands to `repo:`" to "expands to `repo:` or `local:` depending on the source value." The [reference.md](reference.md) field description is updated to reflect this.

### 19. Global symlinks are always absolute

**Decided:** Symlinks from `~/.claude/skills/` to source paths use absolute paths, never relative.

**Why:** Source repos and `~/.claude/` live in unrelated directory trees. A relative symlink would need `../../Projects/my-skills/skills/python-coding` which is fragile — any change to the nesting depth of either side breaks it. Absolute symlinks break only when the source moves, which is the correct failure mode.

### 20. No `dev-dependencies` for global

**Decided:** Global manifest has `dependencies` only.

**Why:** The dev/prod split exists because some skills ship with the product and some are developer-only. Global deps are always developer-only — they're personal tools. The distinction doesn't apply. Adding it would be complexity without purpose.

### 21. Same-origin resolution extends to local sources

**Decided:** When a dependency comes from a local `source:`, its transitive deps can be resolved by scanning the same local source directory. Standalone `local:` deps have no same-origin — they are individual paths with no sibling context.

**Why:** Same-repo resolution exists because a git repo is a coherent collection of related entities. A local source directory serves the same purpose — it's a developer's skill repository on disk. Without same-origin for local sources, every transitive dep from a local skill would need explicit manifest entries, making the manifest as verbose as if local sources didn't exist.

**Edge:** Same-origin scanning walks the local source directory looking for entity matches (directories with `SKILL.md`, `.md` files with agent frontmatter). This is the same heuristic used for same-repo scanning in git repos, applied to a filesystem path instead of a git tree.

### 22. `--discover` for bulk adding from a source

**Decided:** `skilltree add --discover --source <name>` (or `skilltree add --discover <path>`) auto-discovers entities and adds them to the manifest. Works for both global and project manifests.

**Why:** A developer maintaining a local skills repo with 15 skills shouldn't need to `add` each one manually. But the manifest must remain explicit (design principle: "explicit over magic"). `--discover` resolves this — the discovery is automated, but the result is explicit manifest entries. The user confirms before writing.

**Named `--discover`, not `--scan`:** `skilltree scan` is an existing command with a different purpose (detecting undeclared deps in skill body text). Using `--scan` for entity discovery would create confusion. `--discover` clearly communicates "find entities in this directory."

### 23. Tilde preserved in manifest and lockfile

**Decided:** `~` paths are stored literally in both `global.yaml` and `global.lock`. Expansion to `os.homedir()` happens at parse time only.

**Why:** Storing expanded paths (`/Users/dev/Projects/...`) makes the files machine-specific. Storing `~` makes them portable across machines where the home-relative directory structure is the same — a common case for developers who sync their skills repo checkout to the same relative location.

### 24. Global lockfile group is always `prod`

**Decided:** All global lockfile entries use `group: prod`.

**Why:** `group` indicates which manifest section the entry comes from (`dependencies` → `prod`, `dev-dependencies` → `dev`). Global has only `dependencies`, so all entries are `group: prod`. This requires zero schema changes and the semantics are consistent — the field still means "from the `dependencies` section."

## Implementation Notes

### Changes to existing code

1. **Manifest parser** — Accept `~` in `sources:` values and `local:` paths. Expand at parse time via `expandTilde()`. When `source:` resolves to a local path, treat the dependency entry as local (symlinked, no version resolution, always re-read).
2. **Installer** — `installBase` is already parameterized. For global: `expandTilde("~/.claude")`. Symlinks use absolute `sourcePath` (no `resolve(projectDir, ...)` needed when path is already absolute after tilde expansion).
3. **CLI** — `--global` flag on `init`, `add`, `install`, `update`, `remove`, `list`, `verify`, `deps tree`. When set, read/write `~/.skilltree/global.yaml` and `~/.skilltree/global.lock`. Validate incompatible flag combinations (`--global` + `--prod`, `--global` + `--install-path`).
4. **Source expansion** — `resolveSource()` checks if the expanded value is a local path (via `isLocalSource()`). If so, the dependency gets local semantics. The `source:` field description in reference.md is updated.
5. **Same-origin resolution** — Generalize `same-repo` lookup to `same-origin`. For remote sources: scan the git repo (existing). For local sources: scan the filesystem directory. For standalone `local:` deps: skip (no origin).
6. **Lockfile writer** — For global lockfile, write `~`-prefixed paths (not expanded). Add `isGlobal` context so the writer knows to use tilde format instead of relative format.
7. **`list` command** — When running project-level `list`, check if `~/.skilltree/global.lock` exists and has entries. If so, append footer hint.

### New code

1. **`expandTilde(path)`** — Replace leading `~` with `os.homedir()`. Used at manifest/lockfile parse time.
2. **`isLocalSource(value)`** — Returns true if value starts with `~/`, `/`, or `./`.
3. **`--discover` in `add` command** — Walk a directory tree, detect skills (dirs with `SKILL.md`) and agents (`.md` files with valid frontmatter, excluding common non-entity files). Generate manifest entries. Interactive confirmation.
4. **Global path helpers** — `getGlobalManifestPath()` → `~/.skilltree/global.yaml`, `getGlobalLockfilePath()` → `~/.skilltree/global.lock`, `getGlobalInstallBase()` → `~/.claude`.
5. **Same-origin filesystem scanner** — Given a local source directory and a dependency name, scan for a matching entity. Reuses type inference logic (SKILL.md → skill, .md with frontmatter → agent).
