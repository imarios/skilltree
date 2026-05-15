# Carbon Phase 5 — Detailed Plan

Spec: [publication_surface.md](../../../specs/publication_surface.md) §PS23–PS26, PS30, PS32

## Scope

Final phase. Create `skilltree check` command that lints for the asymmetric-publish footgun. Plus the project's last doc updates (README + spec.md).

## Files touched

| File | Change |
|---|---|
| `src/commands/check.ts` | NEW. `checkCommand(dir, opts)`. Walks the resolved graph rooted at every `publish !== false` local entity; flags any reachable same-repo `publish: false` local entity with the full chain. |
| `src/cli.ts` | Register `skilltree check` with `--strict`. |
| `tests/commands/check-publish.test.ts` | NEW. Direct and transitive asymmetric chains; clean repos; cross-repo deps are out of scope. |
| `README.md` | Short section explaining publication-surface and `publish: false` / `exclude:` mechanics. (PS32) |
| `docs/specs/spec.md` | Reference `publish:` field + visibility predicate in the manifest section. (PS30) |

## Design decisions

- **New top-level command.** `skilltree check` is the lint surface. Spec PS26 says "as part of check's existing pass" — but no `check` exists today (there's `verify` for installed-vs-lockfile, which is different). Creating `check` as the new home for design-time lints leaves room for future linters (unused deps, etc.).
- **Walk the resolved graph, not the filesystem.** `resolveAll` already gives us the entity graph with frontmatter dependencies attached as `entity.dependencies: string[]`. Phase 4 (publish:false origin-manifest hide) doesn't affect same-repo locals — those resolve normally — so the graph contains both `publish:true` and `publish:false` entities.
- **Restrict to same-repo deps.** Spec PS25: cross-repo deps are out of scope (those are governed by Phase 4's origin-manifest lookup). Implementation: a `dep` is in-scope iff it resolves to a `local: true` entity. Remote entities have `local: false` and are skipped.
- **BFS from each published root.** Terminate a chain at the first `publish: false` it reaches (no need to traverse deeper; the leak is already identified).
- **`--strict` flag.** Default exit 0 (warnings go to stderr). With `--strict`, exit 1 if any warning. Mirrors existing patterns (`registry index --check`, `scan --check`).
- **Chain rendering.** Indented arrow format so the chain reads top-down.

## Security pre-review

- Reads the project's own manifest + frontmatter; no external I/O. No auth surface.
- Walks at most O(V+E) where V = local entities, E = total frontmatter deps. Bounded by manifest size.

## Phase-specific DoD

- `skilltree check` available as a command.
- Lint detects direct + transitive asymmetric chains.
- `README.md` and `docs/specs/spec.md` updated.
- `bun test` green; tsc + biome clean.
