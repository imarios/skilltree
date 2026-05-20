# Phase 2 — Test Plan

Test file: `tests/core/graph-packs.test.ts` (new)

Helper reuse:
- `createTestRepo` from `tests/helpers/git-fixtures.ts` (creates a non-bare git repo with given skills + optional manifest, tags it).
- Pattern from `tests/core/graph-origin-manifest.test.ts` — `mkdtemp` + `resolveAll(manifest, dir)` + assert on `result.entities` / `result.errors` / `result.warnings`.

All test paths use `file://` URLs on the test repo (same as `graph-origin-manifest.test.ts`).

## Group H: Local pack expansion

### H1. Local pack with 3 remote members expands to 3 entities
Manifest:
```yaml
packs:
  python-pack:
    - {repo: file://<origin>, path: foo, version: "*"}
    - {repo: file://<origin>, path: bar, version: "*"}
    - {repo: file://<origin>, path: baz, version: "*"}
dependencies:
  python-pack:
    pack: python-pack
```
Origin repo has skills at `foo/`, `bar/`, `baz/`.

Asserts:
- `result.entities.size === 3`
- Entity keys: `skill:foo`, `skill:bar`, `skill:baz`
- No entity keyed by `python-pack` or any pack-name
- `result.errors.length === 0`

### H2. Local pack mixed local + remote
One remote member + one local member.

Asserts: both resolved; entity for the local member has `local: true`, `viaPack === "python-pack"`.

### H3. Member with `name:` alias registers under alias
`{repo, path: foo, name: foo-renamed}` → entity key `skill:foo-renamed`, yaml key `foo-renamed`.

### H4. Pack ref in `dev-dependencies` puts members in dev group
Asserts: all member entities have `group: "dev"`.

### H5. Member resolved entity has `viaPack` set
Asserts: every member entity's `viaPack` equals the consumer's yaml key for the pack ref.

### H6. `declaredIn` for local pack member is `{kind: "consumer", manifestPath}`
Asserts: `entity.declaredIn.kind === "consumer"`.

## Group I: Local pack — error paths

### I1. Local pack referenced but undefined
Pack ref `{pack: "missing"}` with no `packs.missing` defined.

Asserts: `errors.some(e => /Pack "missing"/.test(e) && /not defined/.test(e))`.

### I2. Member key collides with consumer-declared dep
Consumer manifest declares `foo` directly AND `python-pack` (which includes `foo`).

Asserts: `errors.some(e => /collides/.test(e) && /"foo"/.test(e) && /python-pack/.test(e))`.

### I3. Two packs sharing a member
Both `pack-a` and `pack-b` contain `foo`. Consumer references both.

Asserts: collision error names both packs.

### I4. Unreferenced local pack → non-blocking warning
Define `packs.unused` but never reference it.

Asserts: `warnings.some(w => /"unused"/.test(w) && /never referenced/.test(w))`; `errors.length === 0`.

## Group J: Remote pack expansion

### J1. Remote pack: members in same containing repo
Origin repo has both the `packs:` definition in skilltree.yml AND the member skills.

Asserts: all 2 members resolved as entities; `declaredIn.kind === "transitive"`; `originRepo` equals the pack's repo.

### J2. Remote pack: members in DIFFERENT repo (Phase 1.5b second-pass)
Origin A defines `packs.python-pack` whose members live in origin B.

Asserts: both repos resolved; members from B installed; idempotent resolve doesn't re-resolve A.

### J3. Remote pack: source-aliased ref resolves
Consumer uses `sources: {acme: file://...}` and references `{pack: python-pack, source: acme, version: "*"}`.

Asserts: member entities resolved as if `repo:` were direct.

## Group K: Remote pack — error paths

### K1. Remote manifest has no `packs:` section
Origin repo's skilltree.yml has only `dependencies:`, no `packs:`.

Asserts: error names repo, ref, and pack name; contains "not found" and "packs:".

### K2. Remote manifest has `packs:` but missing the named pack
Origin defines `packs.other-pack` but consumer asks for `python-pack`.

Asserts: error names repo + ref + missing pack.

### K3. Remote pack member has absolute `local:` path → reject
Origin's `packs.python-pack` includes `{local: /abs/path}`.

Asserts: error names pack + member's absolute path; member is NOT injected.

### K4. Remote pack: containing repo unreachable
Repo URL is bogus.

Asserts: error from Phase 1 (the existing repo-fetch error path); pack expansion gracefully no-ops.

## Group L: State invariants

### L1. After expansion, no PackDependency remains in expanded.dependencies
Asserts: `Object.values(result.expanded.dependencies ?? {}).every(d => !("pack" in d))`. (Exposes `state.expanded` via internal accessor or re-derives by inspecting `result.entities`.)

Actually `resolveAll` doesn't return `expanded`. Skip this as a direct test; covered indirectly by H1 (no pack-named entity).

### L2. `state.entities` never contains an entry for a pack
Already covered by H1 absence-assert.

### L3. Pack expansion runs once per pack ref
Reference the same pack twice (yaml keys: `a`, `b` both with `pack: python-pack, repo: ...`). The members get injected twice → predictable collision per I3 pattern. Document the behavior as the natural consequence of "no merging."

## Smoke

### M1. Existing test suite passes
`bun test` continues green: 1526 → 1526+ new pack tests.

### M2. tsc + biome clean
No new errors after `ResolvedEntity.viaPack`, `ResolutionState.packMemberOrigin`, etc.

## Test fixtures

Reuse existing `createTestRepo` helper. Each test creates an isolated tempdir + builds repos under it (mirroring `graph-origin-manifest.test.ts` exactly).
