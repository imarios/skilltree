# Error Attribution Audit — Nitrogen Phase 4.1

Inventory of every `throw new Error(...)` / `state.errors.push(...)` / `state.warnings.push(...)` site in the resolver / installer / manifest / lockfile layers, classified by attribution quality.

**Classification key:**
- **clear** — error already names the file or manifest the author needs to edit.
- **mis-attributed** — error names the constrained dep but not the manifest that imposed the constraint; reader is misled.
- **ambiguous** — error names a yaml key or entity but doesn't tell the reader *which* manifest declared it. Acceptable when there's only one possible source; problematic when multiple manifests could have introduced it.
- **out-of-scope** — error is structural (parse / schema) and already points at the right file; not addressed by Phase 4.

## Resolver

| File:line | Site | Current text shape | Classification | Phase to fix |
|---|---|---|---|---|
| `src/core/resolver.ts:81-84` | `resolveIntersection` no compatible tag | `Incompatible version constraints:\n  <name> requires <constraint>\n  ...\nNo git tag satisfies all constraints.` | **mis-attributed** — `name` is the dep yaml key, not the manifest doing the requiring. Headline example from #85. | 4.2 |
| `src/core/resolver.ts:68` | `resolveIntersection` no semver tags | `No semver tags found` | **out-of-scope** — internal sentinel consumed by `resolveOneRepo`, never user-facing. | — |

## Graph (dependency resolution)

| File:line | Site | Current text shape | Classification | Phase to fix |
|---|---|---|---|---|
| `src/core/graph.ts:167-169` | `resolveOneRepo` wraps `resolveIntersection` | `Error: Incompatible version constraints for repo <repo>\n\n  <body from resolver>\n\nFix: Align version constraints...` | **mis-attributed** — wraps the mis-attributed body unchanged; no manifest path mentioned. | 4.2 |
| `src/core/graph.ts:187-189` | `resolveOneRepo` catch-block | `Error: Git operation failed\n\n  Failed to fetch <repo>\n  Underlying error: <e>\n\nFix: Check the repo URL in skilltree.yml ...` | **clear** — Fix line points at `MANIFEST_NEW`. | — |
| `src/core/graph.ts:201-203` | tagless-repo warning | `Warning: <repo> has no version tags. Using default branch...` | **clear** — informational; no manifest edit needed. | — |
| `src/core/graph.ts:252-254` | `checkDuplicate` two yaml keys collide | `Error: Duplicate entity resolution\n\n  Both "<keyA>" and "<keyB>" resolve to <composite>.\n\nFix: Use distinct names, or remove one entry.` | **ambiguous** — when the two keys came from different manifests (e.g. one consumer, one transitive), the reader can't tell which to edit. | 4.3 |
| `src/core/graph.ts:374-376` | `resolveRemoteEntity` empty path | `Error: "<entity>" (from <repo>) has an empty \`path:\`. Remove it ...` | **clear** — names entity and repo; only consumer manifest can declare an empty path. | — |
| `src/core/graph.ts:383-385` | `resolveRemoteEntity` no path + no inference | `Error: "<entity>" (from <repo>) has no path, and the resolver could not infer one from: - origin's skilltree.yml dependencies (<repo>) - conventional paths in <repo>` | **clear** — Fix line names `MANIFEST_NEW`; sources tried are listed. | — |
| `src/core/graph.ts:398` | path-mismatch warning | `formatPathWarning(...)` includes origin and consumer paths | **clear** — already names both sides. | — |
| `src/core/graph.ts:413-415` | path not exist at ref | `"<entity>" not found at path "<p>" in repo "<repo>" at <ref>...` | **clear** — names entity, repo, ref. The path came from the consumer manifest, so locus is implicit. | — |
| `src/core/graph.ts:732` | local-source resolution warning (variant) | (not a fail) | **clear** | — |
| `src/core/graph.ts:808-810` | `ensureRepoResolvedLazy` cross-repo conflict | `Error: Cross-repo transitive constraint conflict\n\n  Origin <originRepo> declares <repo> with constraint "<c>", but <repo> is already resolved to <v> ...\n\nFix: Align constraints by declaring <repo> explicitly in your skilltree.yml.` | **clear** — names origin manifest and the resolved chain. Good template for 4.2's rewrite. | (reuse) |
| `src/core/graph.ts:814` | synth constraint name | constraint built with `name: "<transitive via <origin>>"` | **mis-attributed** — synthetic name leaks into the error path on conflict. Replaced by `ConstraintSource.transitive` in 4.2. | 4.2 |
| `src/core/graph.ts:854-901` | `addUnresolvedError` parent declares unknown dep | Multi-line: parent + source + not-found-in: list + Fix | **clear** — already attributes parent dep and its source. | — |
| `src/core/graph.ts:901` | (final push) | (writes the message built above) | — | — |

## Installer

| File:line | Site | Current text shape | Classification | Phase to fix |
|---|---|---|---|---|
| `src/core/installer.ts:266` | already-installed warning | `<entity> already installed. Use --force to overwrite.` | **clear** — not an error; informational. | — |
| `src/core/installer.ts:361-364` | path missing at install time | `"<name>" not found at path "<path>" in <repo> at <ref>. It may have been moved or removed.` | **ambiguous** — doesn't say *where* this entity was declared. When the dep is transitive, the user can't tell which upstream `skilltree.yml` lists it. | 4.3 |

## Manifest / lockfile (validation layer)

| File:line | Site | Current text shape | Classification |
|---|---|---|---|
| `src/core/manifest.ts:14,75-149,270-281,455-480` | schema / type validation | Various — all run against a known manifest file already named in the calling layer (`loadManifestOrThrow`). | **out-of-scope** — already attributed at the call layer. |
| `src/core/lockfile.ts:117,125,130,182` | lockfile parse | Lockfile path already in the layer above (`loadLockfile`). | **out-of-scope** — already attributed at the call layer. |

## Summary

| Classification | Count | Phase |
|---|---|---|
| mis-attributed | 3 sites (`resolver.ts:81`, `graph.ts:167`, `graph.ts:814` synth) | 4.2 |
| ambiguous | 2 sites (`graph.ts:252`, `installer.ts:361`) | 4.3 |
| clear | 8+ sites | — |
| out-of-scope | manifest / lockfile schema (~15 sites) | — |

Phase 4.2 addresses **mis-attributed** (the canonical bug from #85).
Phase 4.3 addresses **ambiguous** (collision-attribution).
Total user-facing rewrites: **5 distinct error messages**. Anything not on this list is either already attributed or structurally out of scope per #85's "fix the top three" mandate.
