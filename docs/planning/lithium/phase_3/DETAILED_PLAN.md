# Lithium Phase 3: Registry-Assisted Add - Detailed Plan

## Goal

When `skilltree add <name>` is called without `--repo`, `--source`, or `--local`, resolve the entity from registered registries. Write the full explicit form (`repo:` + `path:`) to the manifest. Interactive disambiguation when multiple registries match.

Also: update Makefile `setup` target to include `teach` (install the skill globally), bump version, and do full CLI testing with the installed binary.

## Changes to `src/commands/add.ts`

Current flow:
1. Validate mutual exclusivity of `--repo`/`--source`/`--local`
2. If none provided → error "Must specify either --repo/--source or --local"
3. Build dependency entry, write to manifest

New flow:
1. Validate mutual exclusivity
2. **If none provided → registry lookup**:
   a. Load registries, search for exact name match
   b. 0 matches → error with `search` suggestion
   c. 1 match → auto-resolve, confirm
   d. Multiple matches → if `--registry` provided, filter. Otherwise prompt user.
3. Build dependency entry (with resolved `repo:` + `path:`), write to manifest

## New flag

- `--registry <name>` — when adding without `--repo`, limit lookup to this registry

## Edge Cases

- No registries configured → error with `registry add` guidance
- No indexes available → error with `registry update` guidance
- Name not found → error with `search` suggestion
- Multiple matches + no TTY → error listing options with `--registry` suggestion (no interactive prompt)
- `--registry` flag with `--repo` → ignored (explicit wins)

## Makefile Changes

- `setup` target should run `teach` after installing binary
- This ensures the skilltree skill is always up to date after `make setup`

## Files to modify

- `src/commands/add.ts` — registry lookup when no location flags
- `src/cli.ts` — add `--registry` flag to `add` command
- `Makefile` — add `teach` to `setup` target
- `skills/skilltree/references/commands.md` — document `--registry` flag on add
- `skills/skilltree/references/workflows.md` — add discovery workflow
