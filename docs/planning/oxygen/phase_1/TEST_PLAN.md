# Phase 1 — Test Plan

Scope: types + manifest layer for packs. No resolver. No commands. Tests are TDD — written before implementation, must all fail first, then turn green as code lands.

## Test files

- **New**: `tests/core/manifest-packs.test.ts` — all pack parse/validate cases.
- **New**: `tests/core/deps-packs.test.ts` — `canonicalSource` extension for `PackDependency`.
- **Extend**: `tests/core/type-inference.test.ts` (or equivalent) — assert guard-tightening (`isRemoteDependency` / `isSourceDependency` now exclude `PackDependency`).

Existing tests across the suite must continue to pass — this phase ships with zero regressions.

---

## Group A: Parse `packs:` section — `tests/core/manifest-packs.test.ts`

### A1. Parse success (parametrized over member shape)
For each input table row, `parseManifest(yaml)` returns a manifest whose `packs.<name>` deeply equals the expected list.

| Case | Input shape | Expected `packs.python-pack` |
|---|---|---|
| Single remote member | `- {repo, path, version}` | `[{repo, path, version}]` |
| Multi-repo members | `- {repo: A, path}` and `- {repo: B, path}` | both entries |
| Local member | `- {local: ./x}` | `[{local: "./x"}]` |
| Source member (with `sources:` map) | `- {source: alias, path}` | after `expandSources`: `[{repo: <url>, path}]` |
| Member with `name:` alias | `- {repo, path, name: foo}` | preserved |
| Member with `force_path: true` | `- {repo, path, force_path: true}` | preserved |
| Member with `type: agent` | `- {repo, path, type: agent}` | preserved |
| Multiple packs in one manifest | `python-pack: [...]`, `js-pack: [...]` | both present |

### A2. Parse rejection (parametrized)
For each input, `parseManifest(yaml)` throws an error matching the substring.

| Case | Input | Expected error substring |
|---|---|---|
| `packs:` is a string | `packs: hello` | `packs` and `must be a mapping` |
| `packs:` is a list | `packs: [a, b]` | `packs` and `must be a mapping` |
| Pack value is a string | `packs.python-pack: foo` | `python-pack` and `must be a list` |
| Pack value is a mapping | `packs.python-pack: {a: 1}` | `python-pack` and `must be a list` |
| Empty member list | `packs.python-pack: []` | `python-pack` and `at least one member` |
| Member is a string | `packs.python-pack: [foo]` | `python-pack[0]` and `must be a mapping` |
| Nested pack (`pack:` field on member) | `packs.python-pack: [{pack: other}]` | `python-pack[0]` and `nested packs are not supported` |

### A3. Round-trip stability
Parse a manifest with a `packs:` section, serialize it, parse again — deeply equal. Two cases: single-pack and multi-pack manifests. Asserts `serializeManifest` preserves `packs:` without dropping or reordering keys.

---

## Group B: `PackDependency` parsing in `dependencies:` — same file

### B1. Parse success
| Case | Input | Expected `dependencies.python-pack` |
|---|---|---|
| Local pack ref | `python-pack: {pack: python-pack}` | `{pack: "python-pack"}` |
| Remote pack ref | `python-pack: {pack: python-pack, repo, version}` | full shape preserved |
| Source-aliased pack ref | `python-pack: {pack: python-pack, source: acme, version}` | preserved (expansion is `expandSources`'s job) |
| Pack ref in `dev-dependencies` | same shape under `dev-dependencies` | preserved |
| Pack ref renaming via yaml key | `my-stack: {pack: python-pack, repo}` | key `my-stack`, value `{pack: "python-pack", repo}` |

### B2. Parse is permissive; rejection happens in `validateManifest`
Parsing does not reject `PackDependency` with `path:` etc. — `validateManifest` does (see Group D). This mirrors how the codebase already separates parse-shape from validate-semantics.

---

## Group C: `expandSources` for packs — same file

### C1. Source-aliased member is rewritten to remote
```yaml
sources:
  acme: github.com/acme/skills
packs:
  python-pack:
    - source: acme
      path: python-coding
```
After `expandSources`, `manifest.packs["python-pack"][0]` deeply equals `{repo: "github.com/acme/skills", path: "python-coding"}`.

### C2. Source-aliased top-level pack ref is rewritten
```yaml
sources:
  acme: github.com/acme/skill-packs
dependencies:
  python-pack:
    pack: python-pack
    source: acme
    version: ^1.0.0
```
After `expandSources`, `dependencies["python-pack"]` deeply equals `{pack: "python-pack", repo: "github.com/acme/skill-packs", version: "^1.0.0"}`.

### C3. Unknown source alias error
Both pack-member and top-level pack-ref forms throw `Unknown source alias "acme"` (matching the existing error wording).

### C4. Sources untouched for non-pack flows
Existing `expandSources` behavior for plain `dependencies` is unchanged. Regression assertion: re-run an existing source-expansion fixture (or copy one) and confirm output is byte-identical.

---

## Group D: `validateManifest` rules — same file

### D1. `PackDependency` shape rules (parametrized)
For each row, `validateManifest({...})` returns errors containing the substring.

| Case | Input dep | Expected error substring |
|---|---|---|
| Both `repo` and `source` | `{pack: x, repo: a, source: b}` | `repo` and `source` and `mutually exclusive` |
| With `path` | `{pack: x, repo, path: y}` | `path` and `not valid on pack references` |
| With `local` | `{pack: x, local: ./y}` | `local` and `not valid on pack references` |
| With `type` | `{pack: x, repo, type: agent}` | `type` and `not valid on pack references` |
| With `name` | `{pack: x, repo, name: y}` | `name` and `not valid on pack references` |
| With `force_path` | `{pack: x, repo, force_path: true}` | `force_path` and `not valid on pack references` |
| With `version` but no repo/source | `{pack: x, version: ^1}` | `version` and `requires` and `repo` |

### D2. Pack member shape rules
Same dep validation that applies to direct deps applies to members. For each row, the resulting error path is `packs.<name>[<i>]`.

| Case | Member | Expected error path |
|---|---|---|
| Neither `repo`/`source` nor `local` | `{path: foo}` | `packs.python-pack[0]` |
| Both `repo` and `local` | `{repo: a, local: b}` | `packs.python-pack[0]` |
| `publish:` on non-local member | `{repo: a, publish: false}` | `packs.python-pack[0]` and `publish` |
| `exclude:` on non-local member | `{repo: a, exclude: [...]}` | `packs.python-pack[0]` and `exclude` |

### D3. Name-collision rule
```yaml
packs:
  my-stack:
    - {repo: a, path: x}
dependencies:
  my-stack:
    repo: b
    path: y
```
Validation returns an error containing `my-stack`, `packs:`, and `use pack:` (the suggestion in the message).

If, however, `dependencies.my-stack` is the matching `{pack: my-stack}` ref, validation passes (no collision).

### D4. No false positives
A manifest with only `packs:` (no `dependencies:` referencing it) is valid. (Unreferenced packs become a warning at resolve time, not a validation error.)

---

## Group E: `validateGlobalManifest` — same file

### E1. Global manifest may not define packs
```yaml
packs:
  python-pack:
    - {repo: a, path: x}
```
`validateGlobalManifest` returns an error containing `Global manifest does not support` and `packs`. No `packs:` definition allowed; references are fine (passes if only `dependencies.X = {pack: X, repo: ...}`).

---

## Group F: `canonicalSource` — `tests/core/deps-packs.test.ts`

### F1. Local pack ref
`canonicalSource({pack: "python-pack"})` returns `"pack:local:python-pack"`.

### F2. Remote pack ref (direct repo)
`canonicalSource({pack: "python-pack", repo: "github.com/acme/skill-packs"})` returns `"pack:github.com/acme/skill-packs:python-pack"`.

### F3. Source-aliased pack ref (resolved)
`canonicalSource({pack: "python-pack", source: "acme"}, {acme: "github.com/acme/skill-packs"})` returns `"pack:github.com/acme/skill-packs:python-pack"`.

### F4. Source-aliased pack ref (unresolved)
`canonicalSource({pack: "python-pack", source: "missing"}, {})` returns `"pack:unresolved source alias: missing:python-pack"` (or a similarly unambiguous string — assert it differs from the resolved form).

### F5. Equivalence: aliased and direct match
`canonicalSource({pack: "python-pack", source: "acme"}, sources)` equals `canonicalSource({pack: "python-pack", repo: <url>})` when `sources.acme = <url>`. This is what `add`'s overwrite detection will rely on.

### F6. Inequivalence: same repo, different pack name
`canonicalSource({pack: "a", repo: "X"})` ≠ `canonicalSource({pack: "b", repo: "X"})`.

### F7. Pack ref ≠ entity ref with same repo
`canonicalSource({pack: "python-pack", repo: "X"})` ≠ `canonicalSource({repo: "X", path: "python-pack"})`.

---

## Group G: Type-guard tightening — extend `tests/core/type-inference.test.ts` (or new file)

### G1. `isRemoteDependency` excludes `PackDependency`
`isRemoteDependency({pack: "x", repo: "y"})` returns `false`. `isRemoteDependency({repo: "y", path: "z"})` still returns `true`.

### G2. `isSourceDependency` excludes `PackDependency`
`isSourceDependency({pack: "x", source: "y"})` returns `false`. `isSourceDependency({source: "y", path: "z"})` still returns `true`.

### G3. `isLocalDependency` unchanged
`isLocalDependency({pack: "x"})` returns `false` (no `local:` field). Still `true` for `{local: "./x"}`.

### G4. `isPackDependency` recognizes all three shapes
- `isPackDependency({pack: "x"})` → `true`
- `isPackDependency({pack: "x", repo: "y"})` → `true`
- `isPackDependency({pack: "x", source: "y"})` → `true`
- `isPackDependency({repo: "y", path: "z"})` → `false`

---

## Regression set

Run the full existing suite. All must remain green:
- `bun test` (count noted in last commit; e.g., 1382 → ≥1382 + new cases).
- `tsc --noEmit` clean.
- `bunx biome check` clean.

If any existing test fails after the guard-tightening, the root cause is a pre-existing dependency on the loose guard — fix the caller, do not loosen the guard back.

---

## DoD for Phase 1 tests

- [ ] All A1–A3 cases green.
- [ ] All B1 cases green; B2 is a clarification (no test, just doc).
- [ ] C1–C4 green; C4 protects existing source-expansion behavior.
- [ ] D1–D4 green.
- [ ] E1 green.
- [ ] F1–F7 green.
- [ ] G1–G4 green.
- [ ] Full suite green; tsc clean; biome clean.
