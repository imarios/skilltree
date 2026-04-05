# Phase 4: Short Memory

## All stubs implemented

### `src/commands/teach.ts` ✅
- [x] `TeachOptions` interface with `homeDir?` and `agent?`
- [x] `teachCommand(opts?)` — auto-detect, loop, install to each
- [x] `--agent` flag restricts to one agent
- [x] Error when no agents detected
- [x] `findSkillSource()` — kept unchanged (works for both dev and compiled)

### `src/commands/init.ts` ✅
- [x] `InitOptions` interface with `homeDir?`
- [x] `initCommand()` — auto-detect agents, populate `install_targets`
- [x] Fallback to `["claude"]` when no agents detected
- [x] `.gitignore` entries for all detected targets

### `src/cli.ts` ✅
- [x] Teach wiring updated: `--agent` flag, no positional
- [x] Init wiring: unchanged (homeDir not exposed to CLI)

### `src/commands/completion.ts` ✅
- [x] `--agent` flag added to teach definition

### `skills/skilltree/references/commands.md` ✅
- [x] Teach section updated with --agent flag and multi-agent behavior
