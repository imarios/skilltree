# Helium Phase 2: Update, Remove, Duplicate Detection — Detailed Plan

## 1. Selective update by name
Current: deletes lockfile and re-resolves everything.
Target: `skilltree update task-builder` re-resolves only that dep + same-repo entities, keeps lockfile for everything else.

Implementation:
- Read existing lockfile
- If name given: identify the repo for that dep, mark all same-repo entries as "changed" in the diff
- Delete only those entries from lockfile
- Run `installCommand` with the partial lockfile — lockfile-first logic will re-resolve only the missing entries

## 2. Remove interactive prompt
Current: prints warning and silently returns.
Target: prompt `[y/N]` using readline when dependents exist.

Implementation:
- Use `readline` from `node:readline` for stdin prompt
- When dependents found and no `--force`: prompt, wait for answer
- If 'y': proceed with removal
- If anything else: abort

## 3. Duplicate composite key detection
Current: second entry silently ignored in graph.ts.
Target: error with "Both X and Y resolve to type:name".

Implementation:
- In `resolveLocalEntity` and `resolveRemoteEntity`: when `entities.has(compositeKey)` and the existing entity has a different YAML key, collect an error
- Upgrading group from dev→prod for the SAME key is still allowed (not a collision)
