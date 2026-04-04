# Helium Phase 1: Test Plan

## Manifest-Lockfile Diff

- [ ] Detects unchanged entries (same repo, path, compatible version)
- [ ] Detects added entries (in manifest, not in lockfile)
- [ ] Detects changed entries (repo or version constraint changed)
- [ ] Detects removed entries (in lockfile, not in manifest)
- [ ] Handles empty lockfile (all added)
- [ ] Handles empty manifest (all removed)

## Lockfile-First Resolution

- [ ] Unchanged remote dep: no git fetch, entity created from lockfile
- [ ] Unchanged local dep: re-reads frontmatter from filesystem
- [ ] Added dep: full resolution (git fetch + tag listing)
- [ ] Changed dep: full resolution for changed entry
- [ ] Transitive deps from lockfile-cached entries still resolve
- [ ] Mixed: some from lockfile, some fresh, transitive deps across both

## Frozen Mode

- [ ] Errors if no lockfile exists
- [ ] Errors if manifest has entry not in lockfile
- [ ] Errors if lockfile has entry not in manifest
- [ ] Installs from lockfile without resolution
- [ ] Local deps read from filesystem
- [ ] Errors if local dep adds transitive dep not in lockfile
- [ ] Does not write lockfile

## Manifest Validation

- [ ] Rejects dep with both repo and local
- [ ] Rejects dep with neither repo nor local
- [ ] Rejects remote dep without path
- [ ] Rejects same key in both groups
- [ ] Validation runs before resolution (manifest error = no network calls)

## Error Preservation

- [ ] Failed resolution does not write lockfile
- [ ] Existing lockfile preserved after failed install
