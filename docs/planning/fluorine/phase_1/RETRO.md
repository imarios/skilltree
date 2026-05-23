# Fluorine Phase 1 — Retrospective

**Date completed:** 2026-05-23
**Scope:** One phase. ~3 source files + 2 test files + 3 docs touched.

## What went well

- **TDD red→green clean.** Wrote 14 new tests (3 frontmatter, 2 bundled-skill, 9 doctor) before touching production code. Once the implementation landed, all targeted tests went green on the first run; the only failures were existing snapshot/ordering tests that needed to absorb the new `bundled-skill` row — expected and trivial.
- **Reuse, not reinvention.** Composed existing primitives — `parseFrontmatter`, `detectInstalledAgents`, `semver.lt`, the `pc` / `dim` color helpers — instead of growing a separate version-comparison or path-resolution surface. The only new exported helper is `resolveAgentHome` in `agents.ts`, which mirrors `resolveGlobalTarget` but with a testable `homeDir` override.
- **Test isolation.** `runDoctorIsolated` now also injects an empty `homeDir` so the new check is deterministic regardless of the developer's actual `~/.claude/`. Cleaned up with `afterAll`.
- **Spec-first hardening pattern.** Caught the "presence vs value" footgun (CLAUDE.md §"Presence check ≠ value check") during self-review — replaced `!installed` with `installed === undefined`, then a separate `semver.valid` guard for the empty-string / non-semver case. The lint that flagged this in code review for Boron paid off here.

## What was harder than expected

- **Agent path layout is not uniform across agents** (`copilot` detects as `.copilot` but installs to `~/.copilot`; `windsurf` lives at `~/.codeium/windsurf`). Was tempted to derive the install path from the detect path; the right call was to reuse the `AGENT_REGISTRY` entry's `globalHome` field via a new helper. Worth a `[[canonical-agent-path]]` memory.
- **Renderer surprise.** Spec D13 said `→ fix` lines render only on `fail`, but our new warn-status check supplies an actionable fix string. Extended the renderer to show `→ fix` on warn rows too, bumped spec to v1.1, and amended the README copy. Backward-compatible (no existing warn check sets `fix`).

## Learnings

- Sub-projects can be single-phase. Fluorine's footprint is closer to a PatchMode change (~150 lines, 5 source files) than a full multi-phase sub-project, but giving it a name + spec changelog row keeps the elements registry honest and the diff easy to reference later.
- The CLI's own `package.json` version is a natural source of truth for "what should the installed skill look like." We didn't need a separate version-pinning mechanism — runtime injection at `materializeBundledSkill` time keeps the source SKILL.md version-free and avoids a checked-in file the release script would have to mutate.
- Doctor warns are now genuinely actionable (with `→ fix` lines). Future warn-status checks should consider supplying a `fix` string by default.

## Plan adjustments

None. The plan as written matched the implementation 1:1; no surprises required re-scoping.

## Follow-ups (none required, ideas only)

- Could mention the bundled-skill row in `skilltree teach`'s post-install output ("doctor will now confirm v<x>"). Not in scope here.
- If we ever expose a `--ignore-bundled-skill` flag for CI, the existing `homeDir` override could pair with that. No demand today.
