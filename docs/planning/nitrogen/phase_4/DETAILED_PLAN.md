# Phase 4 — Resolver Error Attribution

Tracks: #85 (Authoring UX v1, #78).

## Goal

Every resolver / install error names **the manifest that imposed the offending constraint** and the **dep involved**. Today many resolver messages name only the constrained dep, so the author reading the error cannot tell which file to edit.

Headline example from #85:

| Today | After |
|---|---|
| `✘ greet-helper requires ^1.0.0, but resolved version is 0.9.2.` | `✘ Version conflict on greet-helper:`<br>`  - skilltree.yml requires ^1.0.0`<br>`  - resolved version: 0.9.2`<br>`Fix: bump greet-helper to a compatible release, or relax the constraint in skilltree.yml.` |

Phase 4 lands the catalogue, then the three highest-impact fixes — one sub-phase per PR.

## Sub-phase shape

### Phase 4.1 — Catalogue + snapshot harness

Spec: #85 Phase 1 (catalogue). Read-only documentation + a snapshot harness; no behavior change.

**Files written:**
- `docs/planning/nitrogen/phase_4/error-audit.md` — table with one row per error site.
- `tests/core/error-attribution-snapshot.test.ts` — fixture-driven test that emits each mis-attributed error and snapshots the current text. Baseline that 4.2/4.3 update.

**Catalogue columns:**
| File:line | Site | Current text (truncated) | Classification | Phase that fixes |
|---|---|---|---|---|
| `src/core/resolver.ts:81` | `resolveIntersection` no-match | `<name> requires <constraint>` | **mis-attributed** | 4.2 |
| `src/core/graph.ts:167-169` | `resolveOneRepo` wraps above | `Incompatible version constraints for repo <repo>` + body | **mis-attributed** | 4.2 |
| `src/core/graph.ts:808-810` | `ensureRepoResolvedLazy` cross-repo conflict | `Origin <repo> declares <repo> with constraint "<c>"`, but ... | **clear** | 4.2 reuses helper |
| `src/core/graph.ts:252-254` | `checkDuplicate` two keys collide | `Both "<keyA>" and "<keyB>" resolve to <composite>` | **ambiguous** (no manifest paths) | 4.3 |
| `src/core/installer.ts:361-364` | install path not found | `"<name>" not found at path "<p>" in <repo> at <ref>` | **ambiguous** (no manifest path) | 4.3 |
| `src/core/graph.ts:374-376` | empty `path:` rejected | names entity + repo | **clear** | none |
| `src/core/graph.ts:383-385` | no path + no inference | names entity + repo + sources tried | **clear** | none |
| `src/core/graph.ts:413-415` | path not exist at ref | names entity + repo + ref | **clear** | none |
| `src/core/graph.ts:854-901` | `addUnresolvedError` | names parent + source | **clear** | none |
| `src/core/manifest.ts:14,75,...` | validation errors | structural — author knows the file | **clear** (out of scope) | none |
| `src/core/lockfile.ts:117,125,...` | lockfile parse errors | structural | **clear** (out of scope) | none |

Out-of-scope sites (validation, lockfile parse) are still listed for completeness but not fixed.

**Snapshot harness shape:**

```ts
import { describe, expect, test } from "bun:test";
import { resolveIntersection } from "src/core/resolver";

describe("error attribution snapshots", () => {
  test("resolveIntersection: incompatible constraints", () => {
    const result = resolveIntersection(
      ["v1.0.0", "v2.0.0"],
      [
        { name: "foo", constraint: "^1.0.0" },
        { name: "bar", constraint: "^2.0.0" },
      ],
    );
    expect("error" in result ? result.error : result).toMatchSnapshot();
  });
  // ... one test per mis-attributed site
});
```

The point: 4.2/4.3 will update these snapshots. Any unintended drift in *unrelated* error sites is caught.

### Phase 4.2 — Resolver + graph attribution

Address the canonical case from the issue. The chain to fix:

1. `resolveIntersection` (`src/core/resolver.ts`) takes `Array<{name, constraint}>` and emits `<name> requires <constraint>`. The `name` field is the **dep yaml key**, not the manifest that imposed it.
2. `resolveOneRepo` (`src/core/graph.ts:153`) passes that array to `resolveIntersection` from `resolveRepoVersions` (line 134-151) which builds it from `expanded.dependencies` / `expanded["dev-dependencies"]`.
3. Cross-repo transitive: `ensureRepoResolvedLazy` (`src/core/graph.ts:795`) synthesizes `<transitive via originRepo>` as the fake `name`.

**Plan:**

Introduce `ConstraintSource` discriminated union (in `src/core/resolver.ts` or `src/types.ts`):

```ts
export type ConstraintSource =
  | { kind: "consumer"; manifestPath: string }       // ./skilltree.yml
  | { kind: "transitive"; originRepo: string; ref: string };  // <repo>/skilltree.yml at <ref>
```

Extend the constraints array shape:

```ts
type Constraint = { name: string; constraint: string; source: ConstraintSource };
```

Plumb through `resolveRepoVersions` → `resolveOneRepo` → `resolveIntersection`. The consumer manifest case: `source: { kind: "consumer", manifestPath: "skilltree.yml" }`. The transitive case (graph.ts:814): `source: { kind: "transitive", originRepo, ref: resolution.tag ?? resolution.commit.slice(0, 7) }`.

Rewrite the error builder in `resolveIntersection`:

```ts
const lines = constraints.map(c => `  ${formatSource(c.source)} requires ${c.name} ${c.constraint}`);
return { error: `Version conflict on ${repoOrEntity}:\n${lines.join("\n")}\n\nFix: align constraints in the listed manifest(s).` };
```

Where `formatSource`:
- `consumer` → `skilltree.yml`
- `transitive` → `<repo>/skilltree.yml@<ref>`

Same helper used by `graph.ts:808` so cross-repo transitive conflicts share the format.

Update tests; update snapshots from 4.1; add red→green test that the #85 example matches the after-state literally.

### Phase 4.3 — Collision attribution

`graph.ts:252-254` (duplicate entity resolution) names two yaml keys but not the manifests they came from. The bug: in a transitive dep chain, both keys may have come from different `skilltree.yml` files and the user needs to know which.

**Plan:**

Extend `ResolvedEntity` (and the `state.entities` records) with `declaredIn?: { manifestPath: string }` — the manifest where the yaml key was originally declared. Already partially tracked via `state.manifestKeys` (consumer-manifest membership) but not stored on the entity record itself.

Set `declaredIn`:
- `resolveLocalEntity` / `resolveRemoteEntity` called from `processDeps` (consumer manifest) → `manifestPath: "skilltree.yml"` (or the resolved relative path).
- `resolveTransitive` / `tryResolveFromSameRepo` (transitive) → `manifestPath: "<repo>/skilltree.yml@<ref>"`.

Rewrite `graph.ts:252-254`:

```ts
state.errors.push(
  `Duplicate entity resolution on ${compositeKey}:\n` +
  `  - "${existing.key}" declared in ${existing.declaredIn?.manifestPath ?? "<unknown>"}\n` +
  `  - "${yamlKey}" declared in ${newDeclaredIn ?? "<unknown>"}\n` +
  `\nFix: use distinct names (rename one key), or remove one entry.`,
);
```

`installer.ts:361-364`: include `declared in <manifest>` where the entity record carries `declaredIn`.

Update snapshots, add new tests for collision scenarios (one consumer + one transitive, two transitives from different repos).

## Cross-phase considerations

### Backward-compat of error text

Some tests assert error message substrings (`expect(err).toContain("requires")`). Phase 4.2 changes the wording; we'll fix those tests intentionally. The snapshot harness from 4.1 is the safety net — any other site that we accidentally affect shows up as snapshot drift.

### `--json` doctor output

`doctor`'s `manifest-schema` check renders attribution-style errors today. Phase 4.2/4.3 don't change `doctor`'s output, but they do change the underlying error strings that get embedded into doctor's `detail:` field for any check that exercises the resolver path. That's acceptable — same content, better attribution.

### Performance

Adding a `source: ConstraintSource` field is O(1) per constraint. No new I/O. No measurable cost.

## Security pre-review

| Concern | Impact |
|---|---|
| Path disclosure | Error messages now name manifest paths. These are all paths the author already controls; no escalation. Transitive case names `<repo>/skilltree.yml@<ref>` — the repo URL is already in the resolver state. No secret exposure. |
| Command injection | None — all attribution data flows through string formatting only. |
| Resource use | One extra field per constraint object; negligible. |
| Test fixture leak | Snapshots may contain temp directory paths if fixtures aren't sanitized. Mitigate with a `normalizeSnapshotPaths` helper that strips `${process.cwd()}` and tmpdir prefixes before snapshotting. |

## Risks

- **R1**: Plumbing `ConstraintSource` through `resolveRepoVersions` touches a lot of call-sites. Mitigation: lean on TypeScript to find them; bun test confirms. Phase 4.2 may end up at the upper end of PatchMode (~150 lines) — we'll split into a refactor commit + an attribution commit within the same PR if it gets large.
- **R2**: Some existing tests are likely to assert exact error wording. We'll catch them in the snapshot harness from 4.1 and decide per-case whether to update or rewrite.
- **R3**: Translation/i18n is out of scope (per #85). If a `--json` consumer parses the English error message, that's already brittle today and not our problem.

## Per-phase DoD additions

- `bun test` green; tsc + biome clean.
- New snapshots committed; old assertions intentionally updated with the change called out in the PR body.
- README / commands.md unchanged (no user-visible flag changes).

## File-impact estimate

| Phase | Files touched (approx) | Net lines |
|---|---|---|
| 4.1 | 2 new (audit md + snapshot test) | +80 |
| 4.2 | `resolver.ts`, `graph.ts`, `types.ts`, `resolver.test.ts`, `graph-resolve*.test.ts`, snapshot test | +120 / -40 |
| 4.3 | `graph.ts`, `installer.ts`, `types.ts`, related tests, snapshot test | +80 / -20 |

Each sub-phase fits PatchMode (≤150 net lines, ≤6 files).
