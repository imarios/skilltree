# Phase 5 Short Memory

## Stubs

- [x] `src/core/paths.ts`: added `canonicalPath(p: string): string` with documented contract
- [x] `src/core/deps.ts` (new): exported `canonicalSource(dep, sources?)`
- [x] `src/core/graph.ts`: removed local `normalizePathForCompare`, uses `canonicalPath`
- [x] `src/commands/add.ts`: removed local `describeSource`, imports `canonicalSource`
- [x] `src/commands/add.ts`: generalized to `preserveOrthogonalFields` + `PRESERVED_FIELDS` list
- [x] `CLAUDE.md`: added "Code conventions — Hardening Patterns" section
- [x] `tests/core/paths.test.ts`: parametrized canonicalPath cases + leading-dot-dir safeguard
- [x] `tests/core/deps.test.ts` (new): canonicalSource cases incl. local-alias unification
- [x] `tests/commands/add.test.ts`: preserve-mode invariant test covering force_path + name

## Notes

- Preserve-mode: CAREFUL about mutex fields. Spreading old into new then over with new is the simple form, but when new has `repo:` and old had `local:`, we must drop `local:` not preserve it. Simplest safe pattern: after spread, delete any mutex-adjacent field that's not present on the new dep.
- Actually cleanest: spread `dep` ONTO existing (dep wins for set fields), then walk a list of "preservable orthogonal fields" (`force_path`, `name`, `type`) and preserve them if missing on new. Avoids the mutex problem by being explicit.
- Canonical source for local dep with `_sourceDir` — ignore the internal `_sourceDir` field, it's not part of semantic identity.
