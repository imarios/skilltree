# skilltree - Dependency Manager for AI Agent Skills

## What is this?

Dependency-aware package manager for AI agent skills (SKILL.md) and agents. Uses git repos as the registry, resolves transitive dependencies, supports semver version pinning via git tags, and produces lockfiles for reproducible installs.

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
│   │   ├── manifest.ts      # skilltree.yaml parsing/writing
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
bun test
bun run dev -- install
bun build --compile src/cli.ts --outfile dist/skilltree
```

## Key Design Decisions

1. Git is the registry -- no server, no database
2. `skilltree.yaml` + `skilltree.lock` -- only two state files
3. Lockfile-first for remote deps, always-fresh for local deps (Cargo/npm pattern)
4. Name aliasing for same-name skill/agent collisions -- **marked as hard, needs thorough testing**
5. Kahn's algorithm for topological sort
6. LLM scanning is authoring-only, never in the install path
7. Global deps are a personal convenience, not a project dependency (see below)
8. Vendor mode is a distribution mechanism, not a replacement for skilltree

## Global vs Project vs Vendor — When to Use What

| Need | Mechanism | Who uses it |
|------|-----------|-------------|
| Project needs a skill | `skilltree.yaml` (project dep) | Everyone on the team |
| You want a skill everywhere | `~/.skilltree/global.yaml` (global dep) | Just you |
| Ship skills without upstream access | `skilltree vendor` | Consumers of your repo |

**Global deps are a convenience.** If you want `python-coding` in every project without adding it to each `skilltree.yaml`, put it in your global manifest. But if the project *requires* it, define it in the project's `skilltree.yaml` — that's the contract teammates and CI rely on.

**Vendor is for distribution.** When skills come from a private repo and you need others to use them without access, `skilltree vendor` copies everything into `.claude/` as committed files. Consumers `git clone` and it works — no `skilltree install` needed. The maintainer can `skilltree unvendor` to go back to normal development.

Project deps (`.claude/`, gitignored) and global deps (`~/.claude/`) coexist — project always shadows global. See `docs/specs/global.md` and `docs/specs/vendor.md` for full specs.

## npm Publishing

- **Package name**: `skilltree-pm` (command is still `skilltree`)
- **Platform binaries**: `@imarios/skilltree-cli-{darwin,linux}-{arm64,x64}`
- **Release flow**: Automated via conventional commits. Push a `feat:` or `fix:` commit to main → `release.yml` runs `cz bump` → bumps version in `package.json` + `.cz.toml`, generates `CHANGELOG.md`, tags, pushes → `publish.yml` triggers on the new tag → builds all platforms and publishes to npm.
- **Manual release**: `make release V=x.y.z` for explicit version control.
- **Manual publish**: `./scripts/build-npm.sh && ./scripts/publish-npm.sh`

## Demo GIF

The README demo is a GIF hosted on GitHub Releases (not in git). Re-record only when the demo content is stale (new features, changed commands) — not every release.

```bash
make gh-demo-gif   # records demo/demo.tape with VHS, uploads to latest release
```

The tape script is at `demo/demo.tape`. See `demo/README.md` for details.

## Implementation Phases

Follow phases 1-9 in docs/specs/spec.md. Use TDD.
