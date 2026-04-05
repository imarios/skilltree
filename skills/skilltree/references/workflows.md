# skilltree Workflows

## Start a new project

```bash
skilltree init
skilltree add python-coding --repo github.com/org/shared-skills --path skills/python-coding --version "^1.0.0"
skilltree add my-local-skill --local ./skills/my-local-skill
skilltree install
```

## Teammate joins

```bash
git clone <repo> && cd <repo>
skilltree install        # Reads lockfile, installs exact same versions
```

## Author a skill alongside your code

```bash
# Create the skill
mkdir -p skills/my-skill
# Write skills/my-skill/SKILL.md with frontmatter

# Register as local dep
skilltree add my-skill --local ./skills/my-skill
skilltree install        # Symlinks to .claude/skills/my-skill

# Edit freely — changes reflected instantly (symlink)
vim skills/my-skill/SKILL.md
```

## Check for updates

```bash
skilltree update --dry-run    # Preview what would change
skilltree update              # Apply updates
```

## Upgrade a specific dependency

```bash
skilltree update code-review    # Bumps all entities from same repo
```

## Remove a dependency

```bash
skilltree remove old-skill              # Removes + cleans orphans
skilltree remove old-skill --keep-files # Remove from manifest, keep files
```

## Build for Docker (production)

```bash
# Install prod deps only, copy (no symlinks) to build dir
skilltree install --prod --install-path ./build/.claude

# Dockerfile
# COPY build/.claude /app/.claude
```

## CI validation

```bash
# Fail if lockfile is out of sync with manifest
skilltree install --prod --frozen --install-path ./build/.claude
```

## Scan for undeclared dependencies

```bash
# Quick regex scan
skilltree scan ./skills/

# Pre-commit hook
skilltree scan --check ./skills/

# Auto-fix frontmatter
skilltree scan --apply ./skills/

# Deep scan with LLM (costs money)
skilltree scan --llm ./skills/
```

## Use source shorthands

In `skilltree.yaml`:
```yaml
sources:
  shared: github.com/org/shared-skills
  platform: github.com/org/platform-skills

dependencies:
  python-coding:
    source: shared
    path: skills/python-coding
    version: "^1.0.0"
  deploy:
    source: platform
    path: skills/deploy
    version: "^2.0.0"
```

## Troubleshoot

```bash
# Check what's installed
skilltree list

# Verify file integrity
skilltree verify

# See dependency tree
skilltree deps tree

# Force reinstall everything
skilltree install --force

# Clear git cache and start fresh
skilltree cache clean
skilltree install
```

## Teach coding agents about skilltree

```bash
# Install skilltree skill to all detected agents
skilltree teach

# Install to a specific agent only
skilltree teach --agent claude
```

## Set up multi-agent install targets

Install skills to multiple coding agents at once:

```bash
# See what agents are installed
skilltree targets list

# Add agents to install targets
skilltree targets add codex
skilltree targets add cursor

# Auto-detect all installed agents
skilltree targets detect

# Install deploys to all targets
skilltree install
```

### Migrate from dev_install_path

If your project uses the old `dev_install_path` field:

```bash
skilltree targets migrate    # Converts dev_install_path → install_targets
skilltree targets add codex  # Now you can add more agents
```

## Set up global dependencies

Global deps install to all detected agent homes — available in every project without adding to each `skilltree.yaml`.

```bash
# Initialize global manifest
skilltree init --global

# Add skills you want everywhere
skilltree add --global python-coding --repo github.com/org/skills --path skills/python-coding --version "^2.0.0"
skilltree add --global my-style --local ~/Projects/my-skills/skills/my-style

# Install globally
skilltree install --global

# Check what's installed
skilltree list --global
skilltree verify --global
skilltree deps tree --global
```

**Important:** Global deps are personal convenience. If the project *requires* a skill, add it to the project's `skilltree.yaml`.

## Use local sources (avoid repeating paths)

When many skills come from the same local directory:

```yaml
# skilltree.yaml or ~/.skilltree/global.yaml
sources:
  mine: ~/Projects/my-skills    # local source (starts with ~/)

dependencies:
  python-coding:
    source: mine
    path: skills/python-coding
  general-coding:
    source: mine
    path: skills/general-coding
```

Transitive deps from the same local source are resolved automatically (same-origin resolution).

## Vendor skills for distribution

When skills come from a private repo and consumers don't have access:

```bash
# Copy all deps as committed files (no symlinks)
skilltree vendor

# .claude/ is now committed to git — consumers get it via git clone
git add .claude/ skilltree.yaml skilltree.lock
git commit -m "vendor skills"
```

### Update vendored skills

```bash
skilltree update python-coding    # Update lockfile
skilltree vendor                  # Re-copy with new versions
git add . && git commit -m "bump python-coding"
```

### Exit vendor mode

```bash
skilltree unvendor       # Delete vendored files, restore .gitignore
skilltree install        # Back to normal symlinks
```

### Consumer experience (vendored repo)

```bash
git clone bootstrap-repo
cd bootstrap-repo
# Everything works — .claude/skills/ already populated
# No skilltree install needed, no private repo access needed
```

## Update global deps

```bash
skilltree update --global              # Update all
skilltree update --global code-review  # Update one
```

## Remove global deps

```bash
skilltree remove --global my-style
```
