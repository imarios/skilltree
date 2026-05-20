# Technical Reference

## File Formats

### skilltree.yml (Manifest)

```yaml
name: my-project                  # Project name (informational)
dev_install_path: .claude         # Where developer skills go (default: .claude)
src_install_path: src/skills      # Where application runtime skills go (optional)

# Source shorthand -- avoids repeating repo URLs
sources:
  shared: github.com/org/shared-skills
  platform: github.com/org/platform-skills

dependencies:
  # Remote dep (full form)
  python-coding:
    repo: github.com/user/skills-core
    path: skills/python-coding    # Always required for remote deps
    version: "^2.0.0"
    type: skill                   # Optional, inferred from content

  # Remote dep (with source shorthand)
  code-review:
    source: shared
    path: skills/code-review
    version: "^2.0.0"

  # Remote dep (single-entity repo, SKILL.md at root)
  some-skill:
    repo: github.com/user/some-skill
    path: .

  # Local dep (co-located, symlinked)
  my-style:
    local: ./skills/my-style

  # Slash command (Claude Code) -- single .md file under commands/
  review:
    repo: github.com/org/cmds
    path: commands/review.md
    type: command                 # Required if path doesn't sit under a `commands/` segment

  # Name aliasing (when skill and agent share a name)
  workflow-builder:
    local: ./skills/workflow-builder
    type: skill
  workflow-builder-agent:         # YAML key = alias
    local: ./agents/source/workflow-builder.md
    type: agent
    name: workflow-builder        # Actual entity name

dev-dependencies:
  code-reviewer:
    repo: github.com/user/dev-agents
    path: agents/code-reviewer
    type: agent
    version: "^1.0.0"

  my-experimental-skill:
    local: ./skills/experimental

# Optional: extend `skilltree scan`'s ignore list. See "Ignore List" below.
scan:
  ignore:
    - my-internal-command
```

**Fields per dependency entry:**

| Field | Required | Description |
|-------|----------|-------------|
| `repo:` | Yes (remote) | Git repo URL. Mutually exclusive with `local:`. |
| `source:` | Alternative to `repo:`/`local:` | Alias from `sources:` map. Expands to `repo:` if the source value is a git URL, or acts as `local:` if the source value is a filesystem path (starts with `~/`, `/`, or `./`). See [global.md](global.md) for local sources. |
| `local:` | Yes (local) | Filesystem path. Relative (`./`) for project manifests, `~/` or absolute for global manifests. Mutually exclusive with `repo:`. |
| `path:` | Yes (remote and local-source) | Path within the repo or local source directory. Use `.` for root. Required when using `source:` (both remote and local). Not used with standalone `local:`. |
| `version:` | No | Semver constraint (`^2.0.0`, `>=1.0`, `*`). Default `"*"`. Not used for local deps during install. |
| `type:` | No | `skill`, `agent`, or `command`. Inferred from content if omitted (see "Type inference" below). |
| `name:` | No | Actual entity name when YAML key is an alias. Default: YAML key. |

**Type inference:** Directory containing `SKILL.md` = skill. A single `.md` file under any `commands/` segment = command (Claude Code slash command). Any other `.md` file = agent. Override with explicit `type:` when the path doesn't reflect the intended layout.

**Versioning:** Git tags (`v1.0.0` or `1.0.0`). One repo = one version -- all entities from the same repo share a tag. Multiple constraints on the same repo are intersected.

#### Packs section

A `packs:` top-level mapping defines named groups of dependencies. Each pack name maps to a non-empty list of member dep entries (same shape as direct deps; full source/path/version control).

```yaml
packs:
  python-pack:
    - repo: github.com/acme/python-skills
      path: python-coding
      version: ^1.0.0
    - source: tiangolo
      path: pytest-testing
```

A consumer references a pack with a `PackDependency` entry under `dependencies:` or `dev-dependencies:`:

```yaml
dependencies:
  python-pack:
    pack: python-pack          # required: the pack name to reference
    repo: github.com/acme/skill-packs  # optional: remote pack — repo containing the packs: section
    version: ^2.0.0            # optional: semver constraint on the containing repo's git tag
```

**Pack reference rules:**

| Field | Required | Description |
|-------|----------|-------------|
| `pack:` | Yes | Name of the pack to reference. |
| `repo:` | No | Remote pack — repo containing the `packs:` section. Mutually exclusive with `source:`. |
| `source:` | No | Remote pack via source alias (expands to `repo:` at parse time). |
| `version:` | No | Semver constraint on the containing repo's git tag. Requires `repo:` or `source:`. |

A pack reference may not carry `path`, `type`, `name`, `force_path`, or `local`. With neither `repo:` nor `source:`, the pack is a **local pack reference** — it must resolve in the consumer's own `packs:` section.

**Pack member rules:**

- Members are full dep entries with the same shape as direct deps (no bare names).
- A member may not itself be a `pack:` entry in v1 (nested packs deferred).
- Local-path members (`local:`) in a **remote** pack must be relative; absolute paths are rejected (they would point at the pack author's filesystem).
- Members may be drawn from multiple repos.

**Error matrix:**

| Scenario | Behavior |
|---|---|
| Local pack referenced but undefined | Resolver error: `Pack "X" is referenced under dependencies.X but not defined in this manifest's packs: section.` |
| Remote manifest has no `packs:` / missing the pack | Resolver error names repo + ref + pack name. |
| Pack member collides with a consumer-declared dep | Resolver error names both sides. No silent merge. |
| Two packs share a member | Same collision error. |
| `packs.X` + non-pack `dependencies.X` (same key) | Parse-time error with fix-it hint. |
| `PackDependency` with `path`/`type`/`name`/`local`/`force_path` | Parse-time error names the field. |
| `PackDependency` with `version` and no `repo`/`source` | Parse-time error. |
| Local pack defined but never referenced | Non-blocking warning. |

A pack is never registered as an entity — only its expanded members appear in `state.entities` and the lockfile. See [packs.md](packs.md) for the full spec.

### skilltree.lock (Lockfile)

```yaml
# skilltree.lock -- DO NOT EDIT MANUALLY
# Generated by skilltree v1.0.0
lockfile_version: 1

packages:
  # Remote deps -- same repo shares one resolved tag
  python-coding:
    type: skill
    group: prod
    repo: github.com/user/skills-core
    path: skills/python-coding
    version: 2.1.3
    commit: a1b2c3d4e5f6
    integrity: sha256-xxxx
    dependencies: []

  testing:
    type: skill
    group: prod
    repo: github.com/user/skills-core
    path: skills/testing
    version: 2.1.3               # Same repo = same tag
    commit: a1b2c3d4e5f6
    integrity: sha256-yyyy
    dependencies:
      - python-coding

  # Local dep -- symlinked, no version pinning
  my-style:
    type: skill
    group: prod
    source: local
    path: ./skills/my-style
    commit: HEAD
    dependencies: []

  # Aliased entry -- key is alias, name is actual
  workflow-builder-agent:
    type: agent
    group: prod
    source: local
    path: ./agents/source/workflow-builder.md
    name: workflow-builder
    commit: HEAD
    dependencies:
      - workflow-builder
```

**Lockfile fields:**

| Field | Description |
|-------|-------------|
| `type` | `skill` or `agent` |
| `group` | `prod` or `dev` (reachability from `dependencies` vs `dev-dependencies`) |
| `repo` | Git repo URL (remote deps) |
| `source` | `local` for local deps |
| `path` | Path within repo or relative filesystem path |
| `version` | Resolved git tag (remote deps). Not present for local deps. |
| `commit` | Git commit SHA (remote) or `HEAD` (local, informational) |
| `integrity` | SHA-256 content hash (remote deps only) |
| `name` | Actual entity name (only present when aliased) |
| `dependencies` | List of dependency names |

**Integrity hash algorithm:** List all files recursively, sort by relative path (alphabetical), concatenate `"{relative_path}\0{file_content}"` for each, SHA-256 the result. Deterministic across platforms.

### SKILL.md Frontmatter Dependencies

```yaml
---
name: api-development
description: Building REST APIs with FastAPI and async patterns.
dependencies:
  - python-coding
  - testing
---
```

Name-only list. Resolution details (repo, version) come from the consumer's `skilltree.yml`. Keeps skills portable.

## Resolution Algorithm

### Phase 1: Graph Construction

1. Read `skilltree.yml` to get direct dependencies (remote and local)
2. For each remote dep, fetch content from git (or local cache). For local deps, read from filesystem.
3. Parse SKILL.md frontmatter to discover transitive dependencies
4. Add resolved entities to the **resolution context** (available to all subsequent lookups)
5. Recurse until all transitive deps are discovered
6. Build a DAG using **composite keys** (`type:name`)

**Transitive resolution priority:**
1. Resolution context (already resolved by another chain)
2. Manifest lookup (consumer's `skilltree.yml`, either group)
3. Local-source probe (when the parent is a local dep, look inside its source dir)
4. Origin-manifest lookup (when the parent is a remote dep, read the origin repo's `skilltree.yml` at the pinned ref and look up `dependencies[name]`; `dev-dependencies` are NOT exposed to downstream consumers)
5. Same-repo conventional probe (`skills/<name>/SKILL.md`, `agents/<name>.md`, `commands/<name>.md`, `<name>/SKILL.md`)
6. Error (with actionable fix message)

**Origin-manifest lookup for direct deps (R9):**
- A direct dep `{repo: X, version: Y}` (no `path:`) triggers path inference. Read origin's `skilltree.yml` at the resolved tag; look up the entity's actual name in `dependencies` (never `dev-dependencies`).
- If origin's entry is `local:` relative → use that path.
- If origin's entry is `repo:` pointing at the consumer-declared repo → use origin's `path`.
- If origin's entry points at a **different** repo → fall through to the conventional probe (do not redirect the consumer's `repo:` silently).
- If origin doesn't declare the name, or has no manifest, or the manifest is malformed → fall through to the conventional probe (`skills/<name>/SKILL.md`, `agents/<name>.md`, `commands/<name>.md`, `<name>/SKILL.md`).
- If no tier resolves, error with a message listing every location checked.

**Path warnings (R10):**
- When the consumer provides an explicit `path:` and origin's manifest declares the same name:
  - `path` matches → **redundant** warning ("you can omit `path:`").
  - `path` differs → **override** warning naming both paths; suggests `force_path: true` to silence.
- `force_path: true` on the consumer's entry silences both warnings.
- No warning if origin doesn't declare the name or has no manifest.

**Origin-manifest lookup for transitive deps:**
- Only `dependencies` from origin are consulted, never `dev-dependencies`. Dev-only deps stay upstream-private.
- If origin's entry is `local: ./path/in/repo`, it is treated as a same-repo dep pinned to the parent's tag. This lets authors organize skills at any path (e.g., `skills/source/<name>/`) while keeping auto-resolution for consumers.
- If origin's entry is `repo:` or `source:` (cross-repo), the target repo is cloned and resolved on-demand under origin's declared constraint. Already-resolved repos are reused; a constraint conflict produces a `Cross-repo transitive constraint conflict` error.
- If origin's `local:` path is absolute (e.g., from a `source:` alias expanding to a filesystem path on origin's author's machine), the entry is skipped silently since consumers cannot use such paths.
- If origin's `skilltree.yml` is missing, malformed, or doesn't declare the name, resolution falls through silently to the conventional probe.
- If origin declared the name only under `dev-dependencies`, the error message includes a specific hint pointing at the upstream author.
- If origin declared the name in `dependencies` but marked it `publish: false`, the entry is treated the same as a `dev-dependency` for downstream visibility: resolution falls through, and the actionable error names the reason as `publish: false` so the consumer (and the upstream maintainer) know the fix. See [publication_surface.md](publication_surface.md) §PS15–PS16.

**Declaration order:** Manifest entries processed top to bottom, `dependencies` before `dev-dependencies`. First resolution of a name wins for same-name entities in different repos.

### Phase 2: Version Resolution

For each **repo** in the graph:
1. Collect all version constraints from manifest entries referencing this repo
2. Intersect the constraints
3. List available git tags
4. Find the highest tag satisfying the intersection
5. Error if no tag satisfies all constraints

Local deps skip version resolution -- working tree is the source of truth.

### Phase 3: Validation

**All errors are collected, not fail-fast.** Resolution continues through the entire graph, then reports all issues at once.

1. **Missing deps**: Every frontmatter dependency must be resolvable. Collect all missing deps.
2. **Chain health**: If A depends on B and B's deps are broken, report both.
3. **Cycles**: DFS detection during graph construction. Safety net in Kahn's algorithm.
4. **Type constraints**: Skills depending on agents rejected. Agents can depend on both.
5. **Self-references**: Silently filtered.

If any errors were collected, block install and report all of them together.

### Phase 4: Topological Sort (Kahn's Algorithm)

1. Build adjacency list with composite keys (`skill:python-coding`, `agent:backend-developer`)
2. Calculate in-degrees
3. Process zero-in-degree nodes in sorted order (deterministic)
4. Decrement dependents' in-degrees; add to queue when zero
5. If not all nodes processed, cycle exists

### Phase 5: Installation

1. **Remote deps already installed**: Check integrity hash against lockfile. If modified, warn + require `--force`.
2. **Local deps**: Symlink from `{install_path}/skills/{name}`, `{install_path}/agents/{name}.md`, or `{install_path}/commands/{name}.md` to local path. No chmod, no integrity hash.
3. **Remote deps**: Copy from git cache. Set `chmod 444` for files (directories keep default permissions for manageability).
4. **`--prod --install-path`**: Local deps **copied** (not symlinked). Copies get `chmod 444` for files and integrity hash (they're production artifacts).
5. Compute SHA-256 integrity hash (remote + prod copies).
6. Write lockfile.

**Lockfile-first behavior:**
- Remote deps: use locked versions if lockfile is current. Only resolve new/changed entries.
- Local deps: always re-read from filesystem (Cargo/npm pattern).
- `--frozen`: skip resolution for remote deps; read local deps from filesystem; error if manifest/lockfile out of sync.

## Dependency Detection (Authoring Tool)

`skilltree scan` is an authoring aid for populating the `dependencies` field in SKILL.md frontmatter. It is NOT in the install path.

### Regex Patterns

| Pattern | Regex | Detects |
|---------|-------|---------|
| LOAD directive | `\*\*LOAD\*\*\s+\`([a-z0-9][a-z0-9-]*)\`\s+skill` | `**LOAD** \`code-review\` skill` |
| Use the skill | `[Uu]se\s+the\s+([a-z0-9][a-z0-9-]*)\s+skill` | `Use the python-coding skill` |
| Use backtick skill | `[Uu]se\s+\`([a-z0-9][a-z0-9-]*)\`\s+skill` | `Use \`my-style\` skill` |
| Load the skill | `[Ll]oad\s+(?:the\s+)?([a-z0-9][a-z0-9-]*)\s+skill` | `Load the python-coding skill` |
| Article + skill | `(?:the\|a)\s+[delimiters]?([name])[delimiters]?\s+skill` | `the python-coding skill`, `a \`my-style\` skill` |
| Quoted skill | `[delimiters]([name])[delimiters]\s+skill` | `\`python-coding\` skill`, `"my-style" skill` |

Name validation: >= 2 chars, lowercase alphanumeric with hyphens.

### Ignore List (Builtin + User-Extensible)

The scanner skips two sets of names rather than reporting them as undeclared:

1. **Built-in harness commands** — Claude Code's slash commands (`/loop`, `/simplify`, `/help`, ...) ship with the harness, are not packaged as registry skills, and cannot be declared in `dependencies:`. Maintained as `BUILTIN_HARNESS_COMMANDS` in `src/core/scanner.ts`. Match is exact — `loop` is filtered, `loop-runner` is not.
2. **User-supplied extras** — names listed under `scan.ignore` in `skilltree.yml` (project-scoped) and/or `~/.skilltree/global.yaml` (user-scoped). Same exact-match semantics. The scanner unions both manifests with the built-in set before flagging undeclared references.

```yaml
# skilltree.yml — project-scoped ignores
scan:
  ignore:
    - my-internal-command   # not a registry skill, intentionally undeclared
    - prototype-skill
```

The same list is honored by `--llm` (LLM deep scan), so the two stages don't disagree about which names need declaring.

Use this when:
- Anthropic adds a new built-in slash command before skilltree's built-in list catches up.
- You reference internal slash commands or skills you intentionally don't declare.

Don't use this to silence real undeclared dependencies — declare them with `skilltree add` instead.

### LLM Deep Scan (optional, `--llm`)

Two-phase approach:
1. **Extract**: Send content + known entities list to Claude. LLM identifies semantic deps missed by regex.
2. **Verify**: Send combined candidates back to LLM to filter false positives (plural mentions, hypothetical references, negated references).

Frontmatter deps bypass both phases (trusted). Results are suggestions, never auto-applied. Never in install path or pre-commit hooks.

### Pre-commit Integration

```yaml
# .pre-commit-config.yaml
- repo: local
  hooks:
    # Skill authors: scan tracked source files (NOT gitignored .claude/)
    - id: skilltree-scan
      name: Validate skill dependencies
      entry: skilltree scan --check
      files: '(^skills/.*\.md$|^agents/source/.*\.md$)'
      pass_filenames: true

    # All repos: validate manifest/lockfile consistency
    - id: skilltree-validate
      name: Validate dependency graph
      entry: skilltree install --dry-run --frozen
      files: '(skilltree\.yaml|skilltree\.lock)$'
      pass_filenames: false
```

Post-merge hook (recommended): `skilltree install` after `git pull`.

## Error Messages

### Resolution Errors

Resolution collects ALL errors before reporting (does not halt on the first). This lets users fix all missing deps in one pass:

```
Error: 3 unresolved dependencies

  1. api-development (from github.com/user/skills-core) declares dependency "shared-utils",
     not found in: manifest, resolution context, or github.com/user/skills-core
     Fix: skilltree add shared-utils --repo <repo-url> --path <path>

  2. code-review (from github.com/user/skills-core) declares dependency "linting",
     not found in: manifest, resolution context, or github.com/user/skills-core
     Fix: skilltree add linting --repo <repo-url> --path <path>

  3. code-review (from github.com/user/skills-core) declares dependency "testing",
     not found in: manifest, resolution context, or github.com/user/skills-core
     Fix: skilltree add testing --repo <repo-url> --path <path>
```

```
Error: Incompatible version constraints for repo github.com/user/skills-core

  python-coding requires ^2.0.0
  testing requires ^1.0.0

  No git tag satisfies both constraints.
  Fix: Align version constraints, or move entities to separate repos.
```

```
Error: Broken dependency chain

  api-development depends on testing, but testing has a broken dependency:
    testing declares dependency "python-coding" which is not resolvable.

Fix: Ensure python-coding is in skilltree.yml and its repo is accessible.
```

```
Error: Circular dependency detected

  skill-a -> skill-b -> skill-c -> skill-a

Fix: Remove one of these dependency edges in the skill frontmatter.
```

```
Error: Duplicate entity resolution

  Both "workflow-builder" and "another-skill" resolve to skill:workflow-builder.

Fix: Use distinct names, or remove one entry.
```

### Infrastructure Errors

```
Error: Git operation failed

  Failed to fetch github.com/company/private-skills
  Underlying error: repository not found (or permission denied)

Fix: Check the repo URL in skilltree.yml and your git access (SSH keys, GITHUB_TOKEN).
```

```
Error: Invalid manifest

  skilltree.yml: line 12: mapping values are not allowed here

Fix: Check YAML syntax in skilltree.yml.
```

```
Error: Local dependency path not found

  my-style: ./skills/my-stlye
  Path does not exist.

Fix: Check the `local:` path in skilltree.yml.
```

```
Error: Cannot determine entity type

  Path ./src/utils contains no SKILL.md and is not a .md file.

Fix: Ensure the path points to a skill directory (with SKILL.md) or an agent file (.md).
```

```
Error: Unknown source alias "nonexistent" in dependency my-skill

  Available sources: shared, platform
  Fix: Add "nonexistent" to the sources: section, or use repo: directly.
```

```
Error: Corrupted lockfile

  skilltree.lock could not be parsed (invalid YAML or partial write).

Fix: Delete skilltree.lock and run `skilltree install` to regenerate from manifest.
```

```
Error: Malformed SKILL.md frontmatter

  skills/code-review/SKILL.md: could not parse YAML frontmatter (missing closing ---)

Fix: Check YAML syntax in the skill's SKILL.md file.
```

Malformed frontmatter errors are collected in the batch error pattern (not fail-fast).

### Behavioral Edge Cases

- **`skilltree add` with duplicate name:** Overwrites the existing entry with a warning.
- **`skilltree add` with `--source` and `--repo`:** Error -- mutually exclusive flags.
- **`--frozen` + `--force`:** Orthogonal. `--frozen` controls resolution (skip it, trust lockfile). `--force` controls installation (overwrite modified files). Combined: install exactly what the lockfile says, overwriting any local modifications.
- **`--apply` + `--llm`:** `--apply` auto-updates frontmatter with regex-detected deps only. LLM results are shown as suggestions but NOT auto-applied, even with `--apply`. To apply LLM suggestions, review them and manually add to frontmatter.
- **`skilltree update` without lockfile:** Equivalent to `skilltree install` (full resolution from manifest, creates lockfile). Follows npm precedent.
- **`skilltree install` with 0 dependencies:** Creates a valid empty lockfile (`lockfile_version: 1`, `packages: {}`). No-op for installation.
- **Local dep copy exclusions (`--prod --install-path`):** When copying local deps to a build directory, `.git/` directories are excluded. Only skill/agent content files are copied (`.md` files, `references/` subdirectories). This matches `git archive` behavior for remote deps and prevents bloated Docker images.
- **`--prod` filtering is at install time, not resolution time.** All deps (both groups) are resolved from the full manifest. `--prod` only controls which `group: dev` entries are skipped during the installation step. This ensures Decision #11 works correctly: a dev-dep that is also a transitive prod dep gets `group: prod` and IS installed by `--prod`.
- **`--frozen` does not write the lockfile.** It is read-only (like `npm ci`). Integrity hashes for prod-copied local deps are computed for in-memory verification but not persisted to the lockfile.
- **Failed install leaves lockfile unchanged.** A failed install (cycle, missing deps, etc.) does NOT write a partial lockfile. The previous lockfile is preserved. The next `skilltree install` uses the preserved lockfile according to normal lockfile behavior rules (not "full resolution from scratch").
- **`skilltree remove` on a transitive-only dep:** If `<name>` is not a direct manifest entry, `remove` errors: "`<name>` is not in skilltree.yml. It is a transitive dependency of `<parent>`. To stop installing it, remove or modify `<parent>` instead."
- **Aliased entries in `deps tree`:** Shown as `actual-name@version (type, source)`. The alias is not displayed in the tree -- the tree uses installed names. The lockfile and `skilltree list` show the alias-to-name mapping.
- **Integrity hash and line endings:** The hash is computed on content as retrieved from git's internal storage (remote deps) or as-is from the filesystem (local dep copies). For cross-platform determinism, skill repos should use `.gitattributes` with `* text=auto` to ensure consistent line endings. skilltree does not normalize line endings before hashing.
- **`scan --check` pass/fail criteria:** Exit 1 if regex detects body references to skills not declared in frontmatter `dependencies`. Exit 0 if all body references are declared (or no body references found). Files with frontmatter but no `dependencies` field are treated as having an empty list. Declared-but-not-referenced deps are OK (exit 0).
- **`skilltree add --local` validates path exists** at add-time (fail fast). If the path doesn't exist, `add` errors immediately rather than deferring to `install`.
- **Empty directories:** Not created during installation (git doesn't track empty directories). An empty `references/` directory in a local skill source is not copied. The integrity hash is unaffected (it lists files, not directories).
- **`skilltree update` on a local dep:** Re-reads from the filesystem and updates the lockfile if transitive dependencies changed. There is no version to bump -- local deps always use the working tree.
- **Tag prefix case sensitivity:** Only lowercase `v` is recognized (`v1.0.0`). Uppercase `V1.0.0` is treated as non-semver and ignored. The `semver` npm package handles this by default.
- **`skilltree list` with nothing installed:** Shows an empty table with headers, or "No dependencies installed. Run `skilltree install`."
- **Failed install (cycle, missing deps, etc.):** Does NOT write a partial lockfile. The next `skilltree install` runs full resolution from scratch. If a lockfile existed before the failed run, it is left unchanged.
- **`remove --keep-files` then `install`:** Leftover files from `--keep-files` are ignored by `install` (they have no lockfile entry). If the same dep is re-added later, `install` overwrites the leftover files.
- **`skilltree scan --check` on a non-skill file:** Skips files that have no YAML frontmatter (exit 0). Only validates files that look like skills or agents (contain `---` frontmatter).
- **Install path creation:** `skilltree install` creates the install path and its `skills/`, `agents/`, and `commands/` subdirectories if they don't exist (`mkdir -p` behavior). Applies to both the default `.claude/` path and `--install-path` overrides.

### Warnings

```
Warning: github.com/user/my-skill has no version tags.
  Using default branch (main) at commit a1b2c3d.
  Consider adding semver tags (e.g., v1.0.0) for version control.
```

```
Warning: 1 entity has local modifications:
  testing    MODIFIED

Run `skilltree install --force` to overwrite, or `skilltree verify` for details.
```

### Lockfile Merge Conflicts

Resolution strategy:
1. Resolve conflicts in `skilltree.yml` first
2. Delete the conflicted `skilltree.lock`
3. Run `skilltree install` to regenerate
4. Commit both files
