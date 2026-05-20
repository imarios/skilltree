# Phase 2 — Retrospective

## What went well

- **The "Phase 1.5 + 1.5b" structure paid off immediately.** Making `resolveOneRepo` idempotent and calling `resolveRepoVersions` twice was clean — no special-case bookkeeping for "which repos came from pack expansion." The second pass is a no-op for repos already resolved in Phase 1.
- **All 14 tests went red → green with zero implementation churn.** The DETAILED_PLAN.md sketch matched the implementation 1:1. No mid-flight design changes.
- **Reusing `readOriginManifestAtRef` and `isRelativeLocalPath` from the existing transitive-resolution path** kept the diff small and behaviorally consistent with how same-origin resolution already handles edge cases.
- **`packMemberOrigin` + `packMemberViaPack` as side tables** rather than annotations on the dep object kept the synthesized dep objects clean — no `_viaPack` field leaks into the resolver downstream.

## What surprised us

- **`Dependency` doesn't have a shared `version` field** (LocalDependency doesn't have one). The first cut accessed `dep.version` after determining "this contributes a repo constraint" — tsc caught that LocalDependency has no `version`. Split the version capture into the same `if (isRemoteDependency) ... else if (isPackDependency)` branch.
- **The `noNonNullAssertion` biome rule fired on `deps[memberKey]!`** even though `memberKey in deps` had just been checked. Cleaner fix: capture the dep into a local (`const collidingDep = deps[memberKey]; if (collidingDep) { ... }`), letting the type narrow naturally.
- **Test counts surprised pleasantly.** Only 14 new tests but they cover all of Groups H/I/J/K plus the `viaPack` and `declaredIn` provenance assertions. Parametrized table tests + clear fixture reuse (`createTestRepo`) make these tests trivial to extend later.

## What to carry into Phase 3

- **`isPackDependency` guard in `remove.ts`** — the resolver no longer sees pack refs in `processDeps`, but `remove` reads the manifest directly and would otherwise try to find an entity for a pack ref. Single-line guard.
- **`canonicalSource` Phase 1 work already handles overwrite detection** for pack refs. `add`'s `checkOverwrite` just needs a `isPackDependency(old) || isPackDependency(new)` branch to print a pack-specific message instead of diffing source/repo.
- **Registry scanner `IndexEntry.kind = "pack"`** is the discoverability path — make it optional (default `"entity"`) so existing index caches keep working.

## What to NOT carry forward

- The "remote pack with source-aliased member" scenario (J3 / H5) — skipped in v1's test plan. If a Phase 3 or 4 reviewer asks for it, it's a 20-line test addition; not worth blocking on now.
- Glob mode for `skilltree add 'pack-*'` — Phase 3 already plans to defer.

## Process notes

- LightningMode discipline held: full TDD red→green, no shortcuts. The full phase still took fewer than 90 minutes because the planning artifacts from earlier in the session (the original /loop plan + DETAILED_PLAN.md) eliminated all "what should this look like" hesitation.
- Pre-commit hooks (biome, tsc, commitizen) caught the formatter issues automatically. The two manual biome iterations were both in the implementation phase, not at commit time.
