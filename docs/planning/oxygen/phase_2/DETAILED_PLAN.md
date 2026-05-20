# Phase 2 — Detailed Plan

## Scope

Resolver Phase 1.5 — pack expansion. Local and remote packs both work; pack-member collisions, missing packs, and absolute-local-in-remote-pack all produce typed errors. Pack-member entities carry `_viaPack` provenance and proper `declaredIn` attribution.

## Where pack expansion fits

Three changes to `resolveAll` in `src/core/graph.ts`:

```ts
// Before:
await resolveRepoVersions(expanded, state);
await checkStaleTagManifests(state);
await processDeps(expanded.dependencies, "prod", state);
await processDeps(expanded["dev-dependencies"], "dev", state);

// After:
await resolveRepoVersions(state.expanded, state);     // Phase 1, idempotent
await expandPackReferences(state);                    // Phase 1.5  (NEW)
await resolveRepoVersions(state.expanded, state);     // Phase 1.5b, picks up member repos
await checkStaleTagManifests(state);
await processDeps(state.expanded.dependencies, "prod", state);
await processDeps(state.expanded["dev-dependencies"], "dev", state);
```

`expandPackReferences` mutates `state.expanded.dependencies` (and `["dev-dependencies"]`) in place: deletes pack-ref keys, injects synthesized direct-dep entries for each member.

## Type changes — `src/core/graph.ts`

```ts
// Add `viaPack` to ResolvedEntity for future `why` integration.
// Never serialized to YAML; lockfile already filters internal fields.
export interface ResolvedEntity {
  // ... existing fields ...
  /** If this entity was injected by a pack, the consumer's yaml key for that pack. */
  viaPack?: string;
}

// Add side table on ResolutionState to attribute pack members:
interface ResolutionState {
  // ... existing fields ...
  /**
   * Set during pack expansion; consumed by processDeps to substitute the
   * correct declaredIn for synthesized pack members. Key = the member's yaml
   * key in state.expanded.dependencies (after injection). Value = the
   * EntityOrigin that should be reported for that member.
   */
  packMemberOrigin: Map<string, EntityOrigin>;
  /** Per-member, the consumer's yaml key for the pack that injected it. */
  packMemberViaPack: Map<string, string>;
}
```

## `resolveRepoVersions` — make idempotent

Add early-return guard so the second pass is free for repos already resolved:

```ts
async function resolveOneRepo(repo, constraints, state) {
  if (state.repoResolutions.has(repo)) return;  // NEW: idempotent
  // ... existing body ...
}
```

Also extend the collection step in `resolveRepoVersions` to include `PackDependency.repo` so the containing repo is resolved in Phase 1:

```ts
for (const [key, dep] of Object.entries(deps)) {
  if (isRemoteDependency(dep)) { /* existing */ }
  else if (isPackDependency(dep) && dep.repo) {
    const existing = repoConstraints.get(dep.repo) ?? [];
    existing.push({ name: key, constraint: dep.version ?? "*", source: consumerSource });
    repoConstraints.set(dep.repo, existing);
  }
}
```

## `expandPackReferences` — algorithm

```ts
async function expandPackReferences(state: ResolutionState): Promise<void> {
  for (const group of ["dependencies", "dev-dependencies"] as const) {
    const deps = state.expanded[group];
    if (!deps) continue;
    for (const [key, dep] of Object.entries(deps)) {
      if (!isPackDependency(dep)) continue;
      const result = await fetchPackMembers(group, key, dep, state);
      delete deps[key];
      state.manifestKeys.delete(key);
      if (!result) continue;          // error already pushed
      injectMembers(group, key, dep, result.members, result.origin, state);
    }
  }
  warnUnreferencedPacks(state);
}
```

### `fetchPackMembers` — local vs remote

```ts
interface FetchedMembers {
  members: PackMember[];
  origin: EntityOrigin;   // declaredIn template for members
}

async function fetchPackMembers(
  group: "dependencies" | "dev-dependencies",
  key: string,
  dep: PackDependency,
  state: ResolutionState,
): Promise<FetchedMembers | null> {
  // Local pack: dep has no `repo` (after expandSources). Look up in own manifest.
  if (!dep.repo) {
    const members = state.expanded.packs?.[dep.pack];
    if (!members || members.length === 0) {
      state.errors.push(
        `Error: Pack "${dep.pack}" is referenced under ${group}.${key} but not defined in this manifest's \`packs:\` section.\n\n  Fix: define it in \`packs:\`, or set \`repo:\` to point at a manifest that defines it.`,
      );
      return null;
    }
    return {
      members,
      origin: { kind: "consumer", manifestPath: MANIFEST_NEW },
    };
  }

  // Remote pack: read packs: from the containing repo's manifest.
  const resolution = state.repoResolutions.get(dep.repo);
  if (!resolution) {
    // Phase 1 failed to resolve this repo — error already pushed.
    return null;
  }
  const ref = resolution.tag ?? resolution.commit;
  let manifestContent: string;
  try {
    manifestContent = await readOriginManifestAtRef(resolution.cachePath, ref);
  } catch {
    state.errors.push(
      `Error: Pack "${dep.pack}" not found in ${dep.repo}@${shortRef(ref)} — no skilltree.yml at that ref.`,
    );
    return null;
  }
  let originManifest: Manifest;
  try {
    originManifest = parseManifest(manifestContent);
  } catch (e) {
    state.errors.push(
      `Error: Pack "${dep.pack}": failed to parse skilltree.yml in ${dep.repo}@${shortRef(ref)}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
  const expandedOrigin = expandSources(originManifest);
  const members = expandedOrigin.packs?.[dep.pack];
  if (!members || members.length === 0) {
    state.errors.push(
      `Error: Pack "${dep.pack}" not found in ${dep.repo}@${shortRef(ref)} (expected under \`packs:\` in skilltree.yml).`,
    );
    return null;
  }
  return {
    members,
    origin: { kind: "transitive", originRepo: dep.repo, ref },
  };
}
```

### `injectMembers` — naming, conflict, attribution

```ts
function injectMembers(
  group: "dependencies" | "dev-dependencies",
  packKey: string,
  packRef: PackDependency,
  members: PackMember[],
  origin: EntityOrigin,
  state: ResolutionState,
): void {
  const deps = state.expanded[group]!;
  const isRemotePack = origin.kind === "transitive";
  for (const member of members) {
    // Remote pack with absolute local member → reject. Mirrors the
    // tryResolveFromOriginManifest check (graph.ts:652).
    if (isRemotePack && "local" in member && !isRelativeLocalPath(member.local)) {
      state.errors.push(
        `Error: Pack "${packRef.pack}" (from ${formatOrigin(origin)}) contains a member with an absolute local path ("${member.local}"), which is only valid in local packs.`,
      );
      continue;
    }
    const memberKey = deriveMemberKey(member);
    if (memberKey in deps) {
      const existing = deps[memberKey]!;
      const existingOrigin = describeExisting(memberKey, existing, state);
      state.errors.push(
        `Error: Member "${memberKey}" of pack "${packRef.pack}" (via ${packKey}, ${formatOrigin(origin)}) collides with ${existingOrigin}.\n\n  Fix: remove the duplicate, or rename one yaml key. To override a pack member, do not declare it directly — pick a different pack composition.`,
      );
      continue;
    }
    deps[memberKey] = member as Dependency;
    state.manifestKeys.add(memberKey);
    state.packMemberOrigin.set(memberKey, origin);
    state.packMemberViaPack.set(memberKey, packKey);
  }
}

function deriveMemberKey(m: PackMember): string {
  if ("name" in m && m.name) return m.name;
  if ("path" in m && m.path) return basename(m.path);
  if ("local" in m && m.local) return basename(m.local);
  return ""; // unreachable for validated members; defensive
}

function describeExisting(key: string, dep: Dependency, state: ResolutionState): string {
  const viaPack = state.packMemberViaPack.get(key);
  if (viaPack) return `member of pack "${viaPack}"`;
  return `consumer-declared dep "${key}"`;
}
```

### `processDeps` integration

`processDeps` (graph.ts:236) reads `state.packMemberOrigin` to substitute the right `declaredIn`:

```ts
async function processDeps(deps, defaultGroup, state) {
  if (!deps) return;
  for (const [key, dep] of Object.entries(deps)) {
    const entityName = "name" in dep && dep.name ? dep.name : key;
    const declaredIn =
      state.packMemberOrigin.get(key) ??
      ({ kind: "consumer", manifestPath: MANIFEST_NEW } as EntityOrigin);
    const viaPack = state.packMemberViaPack.get(key);
    await resolveEntity(key, entityName, dep, defaultGroup, state, true, declaredIn, viaPack);
  }
}
```

`resolveEntity` signature gains an optional `viaPack?: string` that propagates through `resolveLocalEntity` / `resolveRemoteEntity` and lands on `ResolvedEntity.viaPack`.

### Unreferenced-pack warning

```ts
function warnUnreferencedPacks(state: ResolutionState): void {
  const packs = state.expanded.packs;
  if (!packs) return;
  // After expansion, any pack ref has been removed from deps. So a pack is
  // "referenced" iff at least one member key in packMemberViaPack maps back to it.
  const referenced = new Set(state.packMemberViaPack.values());
  for (const name of Object.keys(packs)) {
    // The pack name itself is not what we tracked — we tracked the consumer's
    // yaml key for the pack ref. But for *local* packs the conventional case
    // is key === pack name. To avoid false positives we check: did any
    // PackDependency in the original manifest reference this pack name?
    // Simplest: pre-compute a set of "referenced pack names" during the
    // expansion loop.
    if (!state.packsReferencedByName.has(name)) {
      state.warnings.push(
        `Warning: pack "${name}" defined in \`packs:\` is never referenced. Reference it via dependencies, or remove the definition.`,
      );
    }
  }
}
```

Adds `packsReferencedByName: Set<string>` to `ResolutionState`. Populated in `expandPackReferences` *before* entries are deleted from deps.

## Error attribution

Per the Nitrogen Phase 4 convention, every pack-related error names the manifest involved:

- Local-pack errors: `"this manifest's \`packs:\` section"` — the consumer manifest is implicit.
- Remote-pack errors: `<repo>@<short-ref>` via `formatOrigin`.
- Collisions: name both sides — the pack ref (via packKey + origin) and the existing dep (consumer-declared or via another pack).

## What this phase does NOT change

- Installer (`src/core/installer.ts`) — no changes.
- Lockfile schema (`src/core/lockfile.ts`) — no changes.
- `add` / `remove` commands — Phase 3.
- Spec docs (other than this plan + Phase 2 retro) — Phase 4.

## Edge cases handled

| Case | Behavior |
|---|---|
| Local pack referenced but undefined | Error with pack name + ref location |
| Remote pack: manifest missing | Error with repo@ref |
| Remote pack: `packs:` absent or pack name missing | Error with repo@ref + pack name |
| Member name collides with consumer dep | Collision error names both |
| Two packs share a member | Collision error names both via-pack origins |
| Remote pack member has absolute `local:` | Error |
| Pack member's repo not yet resolved | Phase 1.5b second pass picks it up |
| Pack ref in `dev-dependencies` | Members injected into dev-dependencies (then existing prod-promotion rule applies) |
| Local pack defined but unreferenced | Non-blocking warning |

## Forward compatibility for nested packs (v2)

- `expandPackReferences` is structured as a single pass over the deps map. v2 wraps in `do { changed = expandPackReferences(state); } while (changed)` with a visited set keyed by `<repo|local>:<packName>` for cycle detection.
- The `pack:` member rejection in `parsePackMember` is the only hard block today; the structural type already permits packs as members.
- `packMemberViaPack` is a single string in v1; v2 evolves to `packMemberViaPackChain: Map<string, string[]>` for "via pack A → pack B" attribution.

## Files modified

- `src/core/graph.ts` — main implementation
- `tests/core/graph-packs.test.ts` — new test file
