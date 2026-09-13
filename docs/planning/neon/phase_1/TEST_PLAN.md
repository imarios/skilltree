# Phase 1 — Test Plan

Fixtures: `createTestRepo` / `addTagToRepo` from `tests/helpers/git-fixtures.ts`, bare clone via `simpleGit().clone(repo, bare, ["--bare"])`, deps use `repo: file://<bare>` (pattern from `tests/core/graph-capped-warning.test.ts`).

## tests/core/manifest-frozen.test.ts — validation (parametrized)

- **MV1** accepted `frozen` values: `"0.4.0"`, `"v0.4.0"`, `"1.2.3-rc.1"`.
- **MV2** rejected `frozen` values (one error each, message names the dep and says "exact tag"): `"^0.4.0"`, `"~0.4.0"`, `"0.4"`, `"latest"`, `"*"`, `""`, `123`, `true`.
- **MV3** `frozen` + `version` on one entry → error "mutually exclusive".
- **MV4** `frozen` on a `local:` dep → error.
- **MV5** `frozen` on a pack reference → error naming the field.
- **MV6** `frozen` on a pack member → error.
- **MV7** `source:` dep with `frozen` expands to a repo dep carrying `frozen`.

## tests/core/graph-frozen.test.ts — resolver

- **FZ1 (#203)** repo tagged v0.4.0 with `skills/removed-a`, `skills/agent-builder`; v0.6.0 removes `removed-a` and renames to `skills/kibana-agent-builder`. Manifest: `removed-a` frozen 0.4.0, `kibana-agent-builder` `*`. Expect no errors, `removed-a` version 0.4.0 at the v0.4.0 commit, `kibana-agent-builder` 0.6.0, no "capped at" warning.
- **FZ2** the same repo resolved with the pre-fix manifest (`removed-a: version <0.5.0`) still produces the not-found error — guards that non-frozen behavior is unchanged.
- **FZ3** two deps in one repo frozen at different tags → each resolves at its own commit.
- **FZ4** frontmatter dep of a frozen skill that exists only at v0.4.0 in the same repo → resolves, at v0.4.0, entity carries `frozen`.
- **FZ5** same as FZ4 but the consumer also declares the transitive dep unfrozen → it resolves at the shared version (tier priority unchanged).
- **FZ6** `*` dep + frozen sibling at an old tag → no capped warning; `*` dep + `^0.4.0` sibling (unfrozen) → capped warning still emitted.
- **FZ7** frozen tag that never existed → error names dep, repo, tag; no preserved ref written.
- **FZ8** manifest spells `0.4.0`, repo tag is `v0.4.0` (and the reverse) → resolves.

## tests/core/git-frozen-ref.test.ts — preserved commit

- **PR1** after resolving a frozen dep, `refs/skilltree/frozen/v0.4.0` in the cache equals the tag commit.
- **PR2** delete tag v0.4.0 upstream, resolve again (cache fetch prunes the tag) → resolves at the preserved commit, warning says the tag no longer exists and shows the short SHA.
- **PR3** move tag v0.4.0 upstream to a new commit, resolve again → keeps the preserved commit, warning names both SHAs and suggests `skilltree freeze`.
- **PR4** tag deleted upstream and no preserved ref (fresh cache) → error.
- **PR5** unit: `readRef` on a missing ref returns null; `writeRef` then `readRef` round-trips.

## tests/commands/install-frozen-dep.test.ts — lockfile interplay

- **LI1** install with a frozen dep writes lockfile `version: 0.4.0` and the tag commit.
- **LI2** changing `frozen: 0.4.0` → `frozen: 0.3.0` in the manifest makes the next `install` re-resolve (not lockfile-first).
- **LI3** tag deleted upstream after install → `install` (lockfile-first) still installs the locked commit.

## Verification

- `bun test` (timeboxed), `bunx tsc --noEmit`, `bunx biome check`.
