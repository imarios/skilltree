# Design Decisions

## Resolved

### 1. Multi-entity repo versioning
One repo = one version. All skills in a repo share the repo's git tags. When multiple entities from the same repo have different constraints, skilltree intersects them. If you need independent versioning, use separate repos.

### 2. Install lockfile behavior (follows npm/Poetry/Cargo)
Remote deps: if lockfile exists and is consistent with manifest, install from lockfile without re-resolving. Only new/changed entries trigger resolution. **Local deps: always re-evaluated from the filesystem** -- re-read frontmatter, re-check transitive deps, update lockfile if changed. This follows Cargo (path deps re-evaluated every build) and npm (file: deps resolved from filesystem). `--frozen` skips resolution for remote deps but still reads local deps from filesystem.

### 3. Local dependencies (follows Cargo `path` + `version`)
`local:` deps are symlinked for instant feedback during development. Copied (not symlinked) during `--prod --install-path` for Docker builds. Optional `version:` field serves consumers who reference the same entity via `repo:`. Local agents (single `.md` files) are file-symlinked; local skills (directories) are directory-symlinked. Local deps bypass the lockfile for resolution -- the working tree is the source of truth.

### 4. Transitive resolution uses a growing context
Once an entity is resolved (by any method), it becomes available to all subsequent resolution lookups. Priority: manifest -> resolution context -> same-repo default -> error. Prevents order-dependent resolution failures. Entities registered under actual name + type (not YAML alias). Declaration order (top to bottom, `dependencies` before `dev-dependencies`) is the tiebreaker for same-name entities in different repos.

### 5. Modification safety
`skilltree install` checks integrity of existing installed files before overwriting. Modified files trigger a warning; `--force` required to overwrite. Prevents accidental loss of local experiments.

### 6. Type inference
Presence of `SKILL.md` in the path = skill. Single `.md` file = agent. Can be overridden with explicit `type:` in manifest. Path is always required for remote deps (no guessing).

### 7. Name aliasing (follows Cargo `package` rename)
**Marked as hard -- needs thorough testing during implementation.**

YAML keys must be unique, but a skill and agent can share a name (e.g., `workflow-builder`). The YAML key serves as a local alias; the `name:` field specifies the actual entity name for installation. If `name:` is omitted, the key IS the name.

- No filesystem collision: skills install to `skills/`, agents to `agents/`
- Frontmatter `dependencies` use actual names, not aliases
- Disambiguation in frontmatter: `dependencies: [workflow-builder]` **always resolves to the skill** when both skill and agent share the name. Skills can only depend on skills (type constraint forces it). Agents default to skill (common pattern).
- **Known limitation:** There is no frontmatter syntax to target a same-name agent. If an agent needs to depend on another agent that shares a name with a skill, the agent must be renamed to have a unique name. This is an acceptable constraint -- the collision is rare (1 in 42 entities in the real codebase), and renaming is a one-time fix.
- Resolution context registers entities under actual name + type

**Test scenarios that must pass:**
- Skill depending on `workflow-builder` resolves to the skill (type constraint)
- Agent depending on `workflow-builder` resolves to the skill (precedence rule)
- Agent depending on a dep that only the agent (not the skill) provides still works correctly
- `deps tree` shows both entities correctly with their types
- `--prod --install-path` copies both to correct locations
- Lockfile uses YAML key as package identifier, `name:` as installed name
- Two entries resolving to same `(name, type)` is an error
- Frontmatter `dependencies: [workflow-builder]` from an agent resolves to skill (not agent), even though agents can depend on agents

### 8. Source shorthand
The `sources:` map defines repo URL aliases. `source: vibes` expands to `repo:` URL. Simple string substitution. Undefined alias is an error.

### 9. Pre-commit hooks target source directories
`.claude/skills/` is gitignored -- pre-commit file patterns never match installed files. The `skilltree-scan` hook is for skill authoring repos with tracked `skills/` directories. Consumer repos use only `skilltree-validate`.

### 10. Installed files are never checked in
Only `skilltree.yaml` and `skilltree.lock` go into git. `.claude/skills/` and `.claude/agents/` are gitignored. `skilltree init` sets this up.

### 11. Group assignment
If a transitive dependency is reachable from both `dependencies` and `dev-dependencies`, it is `group: prod`. `--prod` must include it.

### 12. Batch error collection during resolution
Resolution does NOT halt on the first error. It continues through the entire graph, collecting all unresolvable dependencies, incompatible constraints, type violations, and cycle paths, then reports them all at once. This lets users fix all issues in one pass instead of iterating through install-fail-fix cycles. Follows the same pattern as TypeScript compiler errors (collect all, report all).

### 13. Lockfile merge conflicts
Resolution strategy (follows npm/yarn convention): resolve `skilltree.yaml` conflicts first, delete conflicted `skilltree.lock`, run `skilltree install` to regenerate. Lockfile uses sorted YAML keys to minimize conflicts.

## Deferred Decisions

Decisions that came up during spec review but were explicitly deferred.

### Behavior Details

| Decision | Status | Leaning | Context |
|----------|--------|---------|---------|
| `scan --check` direction | Undefined | Declared-but-not-referenced is OK | Does a frontmatter dep with no body regex match count as "in sync"? |
| `--install-path` mkdir -p | **Resolved** | Yes | Creates parent dirs (`mkdir -p`) for both default `.claude/` path and `--install-path` overrides. Documented in reference.md behavioral edge cases. |
| `--frozen` transitive dep validation | **Resolved** | Trust lockfile transitives | `--frozen` checks direct manifest entries exist in lockfile. Transitive deps in lockfile are trusted. For local deps: if frontmatter adds a NEW transitive dep not in lockfile, `--frozen` errors ("lockfile out of sync"). |
| `--frozen` local dep path validation | **Resolved** | Yes, error if missing | `--frozen` errors if a local dep's filesystem path doesn't exist. Missing path = broken state, should fail CI. |
| `add --local` with `--version` | Undocumented | Omit version by default | The `add` command doesn't show `--local` + `--version` together. |
| `add --name` flag | Does not exist | Manual YAML edit | CLI path for creating aliased entries. Add later if needed. |
| `--prod` without `--install-path` for local deps | Undefined | Symlink | Copy only activates with `--install-path`. |
| Same key in both groups | **Resolved** | Error | Same YAML key in `dependencies` and `dev-dependencies` is an error. Move the entry to one group. If a dev-dep is also needed by a prod dep transitively, Decision #11 handles it (group = prod). |

### Ecosystem / Future

| Decision | Status | Context |
|----------|--------|---------|
| Upstream manifest propagation | Not supported | Consumer must know cross-repo transitive deps independently. Could add "recommended sources" later. |
| `skilltree lock` command | Does not exist | Standalone lockfile regeneration. Useful for merge conflicts. Consider Phase 4. |
| Windows symlinks | Unaddressed | Fall back to junctions or copies? Decide in Phase 6. |
| Batch `skilltree add` | Not supported | `add dep1 dep2 --repo X` -- hand-editing YAML is faster for now. |
| `skilltree info <name>` | **Resolved** | Specified in [registries.md](registries.md). Shows entity details, available versions, and copy-pasteable `add` command. |
| Breaking transitive dep additions | Accepted as-is | New cross-repo dep in frontmatter breaks consumers on update. Error is clear. Could warn in `outdated` later. |

### 14. Registries are discovery-only
Registries help find and add skills but are never in the install or resolution path. `skilltree add <name>` (without `--repo`) consults registries to resolve the full coordinates, then writes the **full explicit form** (`repo:` + `path:`) to `skilltree.yaml`. The manifest stays self-contained and auditable. See [registries.md](registries.md).

**Rejected alternative:** npm-style shorthand (`python-coding: "^2.0.0"`) where the manifest depends on a global registry for resolution. Rejected because it makes the manifest non-self-contained, creates "works on my machine" from registry ordering when names collide across registries, and breaks `skilltree update` for teammates without the same registries configured. The UX win (shorter YAML) was not worth the implicit external state.

### 15. `sources:` and registries are separate concepts
`sources:` in `skilltree.yaml` are project-scoped URL aliases used during resolution. Registries in `~/.skilltree/config.yaml` are user-scoped discovery tools. They can point to the same git repo. They don't interact. Rationale: merging them creates a conceptual mess — "is this a source or a registry? is it searchable? does it affect install?" Keeping them separate means each concept has one purpose.

### 16. Dual install paths: `dev_install_path` + `src_install_path`
Skills serve two purposes: helping developers write code (dev) and powering the product's AI features at runtime (source). Most users only need the first. The `src_install_path` field is optional — when absent, behavior is exactly like before (everything goes to `.claude/`). When set, `dependencies` install to both paths and `dev-dependencies` install to `dev_install_path` only.

**Key design choice:** The user controls whether `src_install_path` is tracked in git (like `go mod vendor`) or gitignored (like `node_modules/`). Skillkit doesn't care — it just writes files to the path.

**Naming:** `dev_install_path` / `src_install_path` instead of `dev` / `prod` because the distinction is about *where files live* (developer tooling vs application source), not about deployment environments. `src` says "this is part of the source tree" which is accurate regardless of whether the project deploys to Docker, serverless, or anywhere else.

**Progressive disclosure:** New users never see `src_install_path` — they use `dependencies` for everything and it all goes to `.claude/`. Only when they need skills at runtime do they add `src_install_path` and reclassify coding helpers as `dev-dependencies`. This is a one-time conscious decision.

Replaces the legacy `install_path` field (which mapped to `dev_install_path`).

## Open Questions

1. **SKILL.md spec proposal timing.** Propose `dependencies` to agentskills.io before or after proving the concept? Leaning toward after.

2. **Version constraints in frontmatter.** Currently name-only. If skills start declaring versions, the resolver needs upgrading. Defer until demand.
