# Phase 3 — Detailed Plan

## Scope

User-facing surface for packs:
1. `skilltree add` — three new code paths: local short-circuit, `--pack` flag, registry kind=pack.
2. `skilltree remove` — handles pack refs cleanly (no spurious "transitive" hint).
3. Registry scanner — index `packs:` entries from each repo's manifest with `kind: "pack"`.

## Type changes

```ts
// src/types.ts — extend IndexEntry
export interface IndexEntry {
  name: string;
  type: EntityType;
  path: string;
  description?: string;
  tags?: string[];
  /** "pack" for entries that map to a packs: definition; "entity" (default) for skills/agents/commands. Oxygen Phase 3. */
  kind?: "entity" | "pack";
}
```

For packs: `type` is required by the existing schema. Convention: emit `type: "skill"` for packs (since the schema doesn't naturally accommodate "pack" as an entity type) and rely on `kind === "pack"` to disambiguate at consumption time. `path` for packs is set to `pack:<name>` as a stable sentinel — the registry-scanner doesn't have a file path to point at.

(Alternative: extend `EntityType` to include "pack". Rejected: the resolver, installer, and lockfile schema treat `EntityType` as the install-time category, and adding "pack" there leaks the concept into code paths that don't need to know.)

## `add.ts` changes

### `AddOptions`
```ts
pack?: boolean | string;  // --pack (bool) or --pack <new-name> (rename)
```

### `validateAddFlags`
Add rules:
- `--pack` + `--path` → error: "packs don't have paths"
- `--pack` + `--type` → error: "packs aren't entities — --type doesn't apply"
- `--pack` + `--local` → error: "use local packs by defining in `packs:` and referencing by name"

### `buildDependency` — new control flow

```ts
async function buildDependency(name, opts, dir) {
  // Local pack short-circuit: no source flags, no --pack, but packs.<name> exists locally.
  if (!opts.repo && !opts.source && !opts.local && !opts.pack) {
    const manifest = await loadManifestOrThrow(dir, { global: opts.global, globalDir: opts.globalDir ?? getGlobalDir() });
    if (manifest.packs?.[name]) {
      return { pack: name };
    }
  }

  // Explicit pack flag.
  if (opts.pack !== undefined) {
    return buildPackDep(name, opts);
  }

  // (existing) local / source / repo / registry paths unchanged
}

function buildPackDep(name, opts) {
  const packName = typeof opts.pack === "string" ? opts.pack : name;
  if (opts.repo) return { pack: packName, repo: opts.repo, ...(opts.version ? { version: opts.version } : {}) };
  if (opts.source) return { pack: packName, source: opts.source, ...(opts.version ? { version: opts.version } : {}) };
  return { pack: packName };  // local pack ref
}
```

### `resolveFromRegistries` — kind=pack branch

```ts
// existing single-match branch
if (filtered.length === 1) {
  const m = filtered[0];
  if (m.entity.kind === "pack") {
    // Pack discovery via registry. Convention: registry only ever serves the
    // pack as a single repo-coordinate, never multi-repo composition.
    const dep: PackDependency = {
      pack: m.entity.name,
      repo: m.repo,
      version: opts.version ?? "*",
    };
    return dep;
  }
  // (existing entity path unchanged)
}
```

### `checkOverwrite` — pack ref special case

When the existing OR new dep is a pack ref, the source-diff message doesn't apply. Print a pack-specific overwrite line. Reuse `canonicalSource` (Phase 1 already handles pack refs) so the equality test still works — only the *message* differs.

```ts
function checkOverwrite(name, deps, group, dep, sources) {
  if (!(name in deps)) return;
  const oldDep = deps[name];
  const oldIsPack = isPackDependency(oldDep);
  const newIsPack = isPackDependency(dep);
  const oldSource = canonicalSource(oldDep, sources);
  const newSource = canonicalSource(dep, sources);
  if (oldIsPack || newIsPack) {
    if (oldSource !== newSource) {
      warn(`overwriting "${name}" — changing pack reference from ${oldSource} to ${newSource}`);
    } else {
      warn(`overwriting existing pack reference "${name}" in ${group}`);
    }
    return;
  }
  // (existing entity diff message unchanged)
}
```

## `remove.ts` changes

Today, the manifest-mutation paths are generic (delete from `dependencies[name]` / `dev-dependencies[name]`) and work for any `Dependency` shape including pack refs. The lockfile/orphan paths only walk lockfile entries (never include pack refs), so they're no-ops for pack refs.

The only friction point is `validateRemoveTarget`: when name is in the manifest as a pack ref, it works. When name isn't in the manifest but IS in lockfile, it suggests "transitive dependency" — pack refs are never in the lockfile so this branch is irrelevant for them. No change needed there.

What IS needed: when a user removes a pack ref, its expanded members will become orphans on next install. The current `cleanOrphans` logic handles that correctly (it walks the lockfile relative to the new manifest). No change.

**Conclusion: `remove.ts` works for packs without modification.** Add one assertion-style test confirming the no-change behavior so future regressions catch us.

## `registry-scanner.ts` changes

Extend `manifestEntriesFromManifest` to also emit one entry per `manifest.packs[name]`:

```ts
async function manifestEntriesFromManifest(repoDir, manifest) {
  const entries: IndexEntry[] = [];

  // Existing: local deps as kind="entity"
  for (const [key, dep] of Object.entries(manifest.dependencies ?? {})) {
    if (!isLocalDependency(dep)) continue;
    if (!isPubliclyVisible(dep, "dependencies")) continue;
    const normalized = normalizeLocalPath(dep.local);
    if (!normalized) continue;
    const entry = await buildManifestEntry(repoDir, key, dep, normalized);
    if (entry) entries.push(entry);
  }

  // NEW: packs as kind="pack"
  for (const packName of Object.keys(manifest.packs ?? {})) {
    entries.push({
      name: packName,
      type: "skill",          // placeholder; consumers check kind
      path: `pack:${packName}`,
      kind: "pack",
    });
  }

  return entries;
}
```

`parseIndex` already filters to `{name, type, path}` triples — extend to preserve `kind` if present. Otherwise existing caches degrade gracefully (entries without `kind` are treated as entities; pack entries from older caches are absent so no breakage).

## Test plan summary

`tests/commands/add-pack.test.ts` (new):
- Local short-circuit: `packs.foo` exists locally + `add foo` (no flags) → writes `{ pack: foo }`.
- `--pack --repo X --version ^1.0.0` → writes full pack ref.
- `--pack --path x` → rejected with clear message.
- `--pack --local ./y` → rejected.
- `--pack --type agent` → rejected.
- `--pack --dev` → goes to `dev-dependencies`.
- `--pack <new-name>` → renames (yaml key = name arg, `pack:` field = `--pack` arg).
- Overwrite an existing pack ref → uses pack-specific message.
- Overwrite an entity with a pack ref → uses pack-specific message and `canonicalSource` reports different keys.

`tests/commands/add-registry-pack.test.ts` (new, narrow):
- Registry entry with `kind: "pack"` + `skilltree add <name>` → writes pack ref pointing at the registry's repo.

`tests/commands/remove-pack.test.ts` (new, narrow):
- Remove a pack ref from manifest → manifest no longer contains the key; lockfile untouched; no errors about transitives.

`tests/core/registry-scanner-packs.test.ts` (new, narrow):
- Repo manifest with `packs:` → scanner emits one `kind: "pack"` entry per pack.
- `parseIndex` preserves `kind` field; backward-compat: entries without `kind` default to entity.

## Reuse

- `canonicalSource` (Phase 1) handles pack refs — `checkOverwrite` reuses it.
- `isPackDependency` (Phase 1) used in `checkOverwrite` and `buildDependency`.
- `loadManifestOrThrow` (existing) for the local short-circuit lookup.

## Files touched

- `src/types.ts` — `IndexEntry.kind`.
- `src/commands/add.ts` — main work.
- `src/core/registry-scanner.ts` — pack indexing.
- `tests/commands/add-pack.test.ts` — new.
- `tests/commands/add-registry-pack.test.ts` — new.
- `tests/commands/remove-pack.test.ts` — new.
- `tests/core/registry-scanner-packs.test.ts` — new.
- CLI wiring (`src/cli.ts`) — add `--pack [name]` option to `add` command.
