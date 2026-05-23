# Phase 1 — Short Memory

## Stubs to implement

- [x] `src/types.ts`: add `version?: string` to `SkillFrontmatter`
- [x] `src/core/frontmatter.ts`: extract `version` in `parseFrontmatter`
- [x] `src/core/bundled-skill.ts`: add `injectSkillVersion(text, version)`; wire into `materializeBundledSkill` using `pkg.version`
- [x] `src/core/agents.ts`: add `resolveAgentHome(agent, homeDir?)`
- [x] `src/commands/doctor.ts`: add `checkBundledSkill(homeDir?)`; add `homeDir` to `DoctorOptions`; wire into `runDoctor`
- [x] `src/commands/doctor.ts`: render `→ fix` on warn rows too

## Tests written (red → green)

- [x] BS1, BS2 in `tests/core/bundled-skill.test.ts`
- [x] FM1, FM2, FM3 in `tests/core/frontmatter.test.ts`
- [x] BSC1-BSC9 in `tests/commands/doctor.test.ts`
- [x] Updated snapshot + ordering assertions to include `bundled-skill`

## Notes

- `package.json` version import pattern: `import pkg from "../../package.json"` (works in `src/core/`). Doctor lives in `src/commands/`, so path is `../../package.json` from there too — confirm at write time.
- `parseFrontmatter` returns `SkillFrontmatter | null` — null when no frontmatter block; check call sites for new `version` field don't break existing assumptions.
- All new tests should not touch `~/` — use `homeDir` override consistently.
