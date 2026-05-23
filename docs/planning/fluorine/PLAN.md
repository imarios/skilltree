# Fluorine — Bundled-Skill Freshness Check

Project-Type: production
Sub-Project: Fluorine (started 05/23/2026)

Spec extension: [docs/specs/doctor.md](../../specs/doctor.md) (D23 — bundled-skill check, this sub-project)

Adds a single doctor check that detects when the **skilltree skill** (the bundled SKILL.md installed by `skilltree teach`) is missing or stale on the user's system. The CLI can ship a new release that adds skill-side guidance; without this check, the user has no signal that their installed skill is now behind the CLI.

## Project shape

One phase. The change is small (~3 source files, ~120 lines) and touches a well-isolated surface.

```
Phase 1: Bundled-skill freshness check
   │     - bundled-skill.ts stamps `version:` into materialized SKILL.md
   │     - parseFrontmatter extracts `version`
   │     - doctor.ts adds `bundled-skill` check iterating detected agents
   │     - tests + spec + README touch-up
```

## Phase 1: Bundled-skill freshness check

**Why this phase exists.** `skilltree teach` installs the bundled SKILL.md to each detected agent (`~/.claude/skills/skilltree/SKILL.md`, etc.). After the CLI gets upgraded — via `npm`, `make setup`, or anything else — the skill on disk is whatever the *previous* CLI installed. Nothing warns the user. Doctor is the natural surface.

**Design.**

1. **Version source of truth**: the CLI's `package.json` version. Imported via existing pattern (`import pkg from "../../package.json"`, see `src/core/lockfile.ts:5`).
2. **Version stamp**: `materializeBundledSkill` injects `version: "<CLI version>"` into the SKILL.md frontmatter on its way to disk. Idempotent — replaces any existing `version:` line. The checked-in `skills/skilltree/SKILL.md` stays version-less; the version is a property of the installed copy.
3. **Detection**: new check name `bundled-skill`. Iterates `detectInstalledAgents(homeDir)` and, for each agent, reads `<globalHome>/skills/skilltree/SKILL.md`. Reports:
   - missing path → warn ("skilltree skill not installed → run `skilltree teach`")
   - present, no `version` field → warn ("skilltree skill predates version tracking")
   - present, `semver.lt(installed, cli)` → warn ("skilltree skill v<old> behind CLI v<cli>")
   - present, ≥ CLI version → contributes to pass
   - no agents detected → skip (`"no coding agents detected"`)
4. **Scope**: runs in both project and `--global` mode — the bundled skill is a global concept, independent of project manifest.

**Tasks** (TDD order)

- [x] **T1** Extend `SkillFrontmatter` type to include `version?: string`, update `parseFrontmatter` to extract it
- [x] **T2** Add `injectSkillVersion(text, version)` helper in `bundled-skill.ts`; wire into `materializeBundledSkill`
- [x] **T3** Add `checkBundledSkill(homeDir?)` in `doctor.ts`; push into `runDoctor` orchestrator
- [x] **T4** Extend `DoctorOptions` with `homeDir?: string` for test injection
- [x] **T5** Tests: bundled-skill materialization stamps version; per-agent check semantics (missing / current / stale / no-version / no-agents); JSON shape
- [x] **T6** Update `docs/specs/doctor.md` (add D23 row + acceptance criteria); README touch-up
- [x] **T7** RETRO

## Phase status

Phase 1: ✅ COMPLETE (2026-05-23)

**Critical files**

| File | Change |
|---|---|
| `src/types.ts` | Add `version?: string` to `SkillFrontmatter`. |
| `src/core/frontmatter.ts` | Read `version` from parsed YAML into result. |
| `src/core/bundled-skill.ts` | Inject `version:` line into SKILL.md frontmatter before writing. |
| `src/commands/doctor.ts` | Add `checkBundledSkill`; extend `DoctorOptions.homeDir`. |
| `tests/core/bundled-skill.test.ts` | Assert injected version matches package.json. |
| `tests/commands/doctor.test.ts` | Per-agent scenarios using `homeDir` fixture. |
| `docs/specs/doctor.md` | New D23 requirement + acceptance criteria. |
| `README.md` | Mention freshness warning under doctor section if applicable. |

**Definition of Done**

- All new tests pass; existing tests still pass (`bun test`)
- `bun run dev -- doctor` shows the new row
- `materializeBundledSkill` writes a SKILL.md with semver-valid `version:` matching `package.json`
- spec doctor.md updated with D23
