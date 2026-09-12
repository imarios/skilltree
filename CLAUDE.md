# skilltree - Dependency Manager for AI Agent Skills

## What is this?

Dependency-aware package manager for AI agent skills (SKILL.md), agents, and Claude Code slash commands. Uses git repos as the registry, resolves transitive dependencies, supports semver version pinning via git tags, and produces lockfiles for reproducible installs.

## Docs

```
docs/
├── specs/
│   ├── spec.md              # Core spec: concepts, commands, phases
│   ├── reference.md         # Technical: file formats, algorithm, error messages
│   ├── decisions.md         # Design decisions (resolved + deferred), open questions
│   └── background.md        # Why skilltree, alternatives comparison
├── planning/                # Phase planning docs (hydrogen, helium, etc.)
└── PROJECTS.md              # Project tracking
```

## Tech Stack

- **Language**: TypeScript
- **Runtime**: Bun (development + `bun build --compile` for single binary)
- **Also works with**: Node.js (`npx skilltree`)
- **Key deps**: `simple-git`, `semver`, `yaml`, `commander`

## Project Structure

```
skilltree/
├── src/
│   ├── cli.ts              # CLI entry point (commander)
│   ├── commands/            # One file per command
│   ├── core/
│   │   ├── manifest.ts      # skilltree.yml parsing/writing
│   │   ├── lockfile.ts      # skilltree.lock parsing/writing
│   │   ├── resolver.ts      # Version resolution (semver constraints)
│   │   ├── graph.ts         # Dependency graph + topological sort
│   │   ├── git.ts           # Git operations (clone, fetch, tags)
│   │   ├── installer.ts     # File copy, symlinks, permissions
│   │   ├── scanner.ts       # Dependency detection (regex)
│   │   ├── llm.ts           # Optional LLM dependency detection
│   │   └── frontmatter.ts   # SKILL.md frontmatter parsing
│   └── types.ts
├── tests/
├── docs/
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

## Development

```bash
bun install
pre-commit install
pre-commit install --hook-type post-merge  # auto-rebuilds local binary after version bumps
bun test
bun run dev -- install
bun build --compile src/cli.ts --outfile dist/skilltree
```

### Tests run with a sandboxed `$HOME`

`bunfig.toml` preloads `tests/setup/sandbox-home.ts`, which points `$HOME` at a
temp directory for the whole run. Don't remove it: `install --global` and
`teach` resolve their install targets through `expandTilde("~/.claude")`, not
through the `homeDir`/`globalDir` test overrides, so without the sandbox every
test touching the global path wrote into the developer's real
`~/.claude/skills/` — overwriting whatever `skilltree teach` had installed and
leaving symlinks into deleted temp dirs behind, which Claude Code then tried to
load.

This works because `homeDir()` in `src/core/paths.ts` reads `$HOME` before
falling back to `os.homedir()` (Node consults `$HOME` on POSIX too; Bun caches
it at process start and ignores later changes). Tests that assert on the home
directory must use `homeDir()`, not `os.homedir()`, or they will compare
against the real home the code no longer uses.

### `bun.lock` is committed

CI installs with `bun install --frozen-lockfile`, so the dev toolchain only
moves when someone commits a new lockfile. Before that, `bun.lock` was
gitignored and a new minor of `@biomejs/biome` turned `Lint` red on a PR that
had changed nothing (#163). If you change a dependency, run `bun install` and
commit the resulting `bun.lock` in the same PR.

`release.yml` refreshes the lockfile inside the bump commit, because `cz bump`
rewrites the self-referential `optionalDependencies` on every release.

Upgrades come back in via Dependabot (`.github/dependabot.yml`), weekly and
grouped, so pinning doesn't mean rotting (#168). It ignores
`@imarios/skilltree-cli-*` — those are release-managed by `cz bump`, not
dependencies to track.

## Key Design Decisions

1. Git is the registry -- no server, no database
2. `skilltree.yml` + `skilltree.lock` -- only two state files
3. Lockfile-first for remote deps, always-fresh for local deps (Cargo/npm pattern)
4. Name aliasing for same-name skill/agent collisions -- **marked as hard, needs thorough testing**
5. Kahn's algorithm for topological sort
6. LLM scanning is authoring-only, never in the install path
7. Global deps are a personal convenience, not a project dependency (see below)
8. Vendor mode is a distribution mechanism, not a replacement for skilltree

## Global vs Project vs Vendor — When to Use What

| Need | Mechanism | Who uses it |
|------|-----------|-------------|
| Project needs a skill | `skilltree.yml` (project dep) | Everyone on the team |
| You want a skill everywhere | `~/.skilltree/global.yaml` (global dep) | Just you |
| Ship skills without upstream access | `skilltree vendor` | Consumers of your repo |

**Global deps are a convenience.** If you want `python-coding` in every project without adding it to each `skilltree.yml`, put it in your global manifest. But if the project *requires* it, define it in the project's `skilltree.yml` — that's the contract teammates and CI rely on.

**Vendor is for distribution.** When skills come from a private repo and you need others to use them without access, `skilltree vendor` copies everything into `.claude/` as committed files. Consumers `git clone` and it works — no `skilltree install` needed. The maintainer can `skilltree unvendor` to go back to normal development.

Project deps (`.claude/`, gitignored) and global deps (`~/.claude/`) coexist — project always shadows global. See `docs/specs/global.md` and `docs/specs/vendor.md` for full specs.

## npm Publishing

- **Package name**: `skilltree-pm` (command is still `skilltree`)
- **Platform binaries**: `@imarios/skilltree-cli-{darwin,linux}-{arm64,x64}`
- **Release flow**: Automated via conventional commits. Push a `feat:` or `fix:` commit to main → `release.yml` runs `cz bump` → bumps version in `package.json` + `.cz.toml`, generates `CHANGELOG.md`, tags, pushes → `publish.yml` triggers on the new tag → builds all platforms and publishes to npm.
- **Manual release**: `make release V=x.y.z` for explicit version control.
- **Manual publish**: `./scripts/build-npm.sh && ./scripts/publish-npm.sh`
- **Publish verification**: both workflows call `./scripts/verify-npm-publish.sh <package> <version>`
  after publishing. It polls the registry for 5 minutes, because npm is
  read-after-write eventual and a version can take minutes to resolve. A
  timeout there means the publish succeeded but is not visible yet — not a
  refused publish (#198); re-running the job is safe. Keep the budget generous:
  it has been set too tight twice (#39, #198), and a red Release run that was
  actually fine is what teaches people to ignore the genuinely broken ones
  (#170).

## Demo Video

The README demo is an MP4 video hosted on GitHub Releases (not in git). Re-record only when the demo content is stale (new features, changed commands) — not every release.

```bash
make gh-demo   # records with VHS, converts to MP4, uploads to latest release
```

The tape script is at `demo/demo.tape`. See `demo/README.md` for details.

## Implementation Phases

Follow phases 1-9 in docs/specs/spec.md. Use TDD.

## Code Conventions — Hardening Patterns

Four patterns earned their way in after a hypothesis-driven review of the Boron sub-project (see `docs/planning/boron/phase_5/REVIEW_NOTES.md`). Follow them in new code.

### 1. Canonical-identity helpers for union types

When two different shapes in a type union can represent the same resource, compare via a **canonical-identity function** rather than ad-hoc field equality. Examples shipped:

- `canonicalPath(p)` in `src/core/paths.ts` — use wherever you ask "do these two paths refer to the same git tree location?"
- `canonicalSource(dep, sources?)` in `src/core/deps.ts` — use wherever you ask "do these two deps point at the same source?"

If you find yourself writing `a.foo === b.foo` where `a` and `b` might be different union variants, you probably need a canonical-identity function.

### 2. Presence check ≠ value check

Prefer explicit comparisons over coercive truthy/falsy checks at decision points:

- **Presence check** → `value === undefined` (or `value == null`).
- **Value check** → `value === true` / `value === expectedValue`.
- `!value` only for truly binary booleans where "unset" and "false" should branch together.

Rationale: `!dep.force_path` and `!entityPath` both looked reasonable and both shipped bugs. The former silenced warnings for non-boolean truthy values (e.g., a stringy `"false"`); the latter treated `""` as equivalent to `undefined` and silently inferred a skill path when the user clearly authored a blank.

### 3. Preserve-mode on overwrite

When a CLI (or any structured-entry writer) replaces an existing entry, **preserve orthogonal user-authored fields by default** rather than reconstructing the entry from scratch.

Current implementation: `preserveOrthogonalFields` in `src/commands/add.ts` copies `force_path` and `name` from the old entry into the new one if the CLI didn't set them. Add to the `PRESERVED_FIELDS` list when introducing a new user-authorable field that the CLI doesn't manage.

Do NOT preserve identity/mutex fields (repo/source/local/path/version) — the CLI should win for those.

### 4. Parametrized edge-case tests for helpers

Test normalization helpers with a parametrized list of equivalent inputs (`["./foo", "foo", "/foo", "foo/", "././foo", ...]`), not one-at-a-time. When a new edge case shows up, add a row to the table and the helper gets the fix in one place. See `tests/core/paths.test.ts` for the pattern.
