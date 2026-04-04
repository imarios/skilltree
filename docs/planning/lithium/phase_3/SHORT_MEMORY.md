# Lithium Phase 3: Short Memory

## Changes

### src/commands/add.ts
- [ ] Registry lookup when no `--repo`/`--source`/`--local`
- [ ] `--registry` flag support
- [ ] Error messages with guidance

### src/cli.ts
- [ ] Add `--registry` option to `add` command

### Makefile
- [ ] Add `teach` to `setup` target

### skills/skilltree/references/commands.md
- [ ] Document `--registry` flag on add

## Notes
- `addCommand` needs to import registry search utilities
- Multiple matches without TTY → list options + suggest `--registry`
- Interactive disambiguation deferred if no TTY detection is needed (CLI tool)
