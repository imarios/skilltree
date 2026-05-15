# Carbon Phase 5 — Test Plan

## tests/commands/check-publish.test.ts

### Direct asymmetry

- `analysis-pipeline` (publish:true) directly depends on `experimental-refactor` (publish:false) → 1 warning showing the 2-node chain.

### Transitive asymmetry

- `analysis-pipeline` → `data-loader` (publish:true) → `experimental-refactor` (publish:false) → 1 warning showing the 3-node chain.

### Multiple chains from one root

- `analysis-pipeline` → `a` (publish:false) AND → `b` (publish:false) → 2 warnings.

### Clean manifest

- All entities `publish:true` → no warnings, exit 0.
- All entities `publish:false` → no warnings (no exposed roots to lint).

### Out of scope

- Cross-repo dep (remote): the consumer's published entity depends on a remote name — lint doesn't reach into the remote, no warning here. Phase 4's mechanism handles that case at install time.

### Strict mode

- `--strict` with at least one warning → exit code 1.
- `--strict` with no warnings → exit code 0.
