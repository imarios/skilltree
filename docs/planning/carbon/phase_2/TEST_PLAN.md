# Carbon Phase 2 — Test Plan

## tests/core/registry-scanner-fallback.test.ts (new)

### Tier ordering

- Curated `skilltree-index.yml` present + manifest present → curated wins.
- Curated absent, legacy `skillkit-index.yaml` present + manifest present → legacy still wins (with deprecation warning).
- No index file, manifest with ≥1 visible local entry → manifest tier emits those entries.
- No index file, no manifest → dynamic scan as today.

### Manifest tier behavior

- Single skill local entry → emits one IndexEntry with `type: skill`, correct name, correct path.
- Name inferred from YAML key when entry has no explicit `name:`.
- Type inferred to `skill` when path is a directory; `agent`/`command` from `.md` extension and `mdFileType`.
- Description picked up from SKILL.md frontmatter when present.
- Multiple local entries → all emitted, deduped by name (existing behavior).
- `publish: false` entry → filtered out.
- `dev-dependencies` local entry → filtered out (group check).
- Remote entries (`repo:`/`source:`) → ignored (not local).
- Local entry pointing at `/abs/path` or `~/path` → skipped silently (not part of this repo).

### Fallthrough

- Manifest present with only dev-dependencies local entries → tier 2 falls through to dynamic scan.
- Manifest present with only remote deps → tier 2 falls through.
- Manifest present with only `publish: false` local entries → tier 2 falls through (no visible entries).

## tests/commands/index-cmd-publish.test.ts (new)

- `skilltree registry index` in a repo with one local skill + one `publish: false` local skill → output contains only the non-publish-false one.
- `--check` exits 0 when on-disk index matches the filtered view.
- Repo without `skilltree.yml` → no filtering applied (today's behavior preserved).
