# Phase 1 — Test Plan

## bundled-skill.test.ts (new cases)

- **BS1**: `materializeBundledSkill` writes a SKILL.md whose frontmatter contains `version: "<package.json version>"`. Parse with `parseFrontmatter`; assert equality with `pkg.version` from `package.json`.
- **BS2**: `materializeBundledSkill` is idempotent on re-run — version stays correct, no duplicate `version:` lines.

## frontmatter.test.ts (new case)

- **FM1**: `parseFrontmatter` extracts `version` when present as a string.
- **FM2**: `parseFrontmatter` ignores non-string `version` (does not throw).

## doctor.test.ts (new describe block: "bundled-skill check")

Each test uses a temporary `homeDir` fixture and an isolated registry config so the suite stays network/disk-clean.

- **BSC1** Missing skill → warn. Fixture: homeDir contains `.claude/` (so the agent is detected) but no `skills/skilltree/SKILL.md`. Expect: status `warn`, detail mentions "claude", fix mentions `skilltree teach`.
- **BSC2** Current version → pass. Fixture: homeDir contains `.claude/skills/skilltree/SKILL.md` with `version: <pkg.version>`. Expect: status `pass`.
- **BSC3** Stale version → warn. Fixture: SKILL.md with `version: "0.0.1"`. Expect: status `warn`, detail mentions "behind" or version numbers.
- **BSC4** No version field → warn. Fixture: SKILL.md with `name: skilltree` only. Expect: status `warn`, detail mentions "predates" or "no version".
- **BSC5** No agents detected → skip. Fixture: empty homeDir. Expect: status `skip`, detail mentions "no coding agents".
- **BSC6** Mixed agents (claude current, cursor stale) → warn with per-agent detail.
- **BSC7** JSON mode includes the bundled-skill row.
- **BSC8** `--global` mode still runs this check (it's not project-scoped).
- **BSC9** Future version (installed > CLI) → pass (no false negative).

## Verification

- `bun test` — full suite green
- `bun run dev -- doctor` in a temp dir with no `~/.claude/skills/skilltree/` → shows warn row
- Inspect actual `~/.claude/skills/skilltree/SKILL.md` after running `bun run dev -- teach` → contains `version:` line matching package.json
