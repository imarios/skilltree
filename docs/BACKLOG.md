# Backlog

## Must-Do Soon

- [x] **R10a: Stale target detection** — `skilltree install` warns when lockfile records `install_targets` no longer in manifest. → Fixed.

- [x] **R19: Vendor single-target guard** — `skilltree vendor` errors when `install_targets` has multiple entries without `--target <name>`. → Fixed.

## Nice-to-Have

- [x] **R17-R18: Global manifest `--global` flag for targets** — CLI wiring for `--global` on all targets subcommands. → Fixed.

- [x] **R21: Teach as global dep** — `teach` now uses `addCommand` + `installCommand` internally. Skilltree skill appears in global lockfile. → Fixed in Phase 6.

- [x] **Migration guide** — Documented in commands.md under `targets migrate`. → Fixed.

## Carbon follow-ups (issue #63 / publication surface)

- [ ] **Vendor + dev-dependencies — strict-spec interpretation.** Spec
  PS20 says "vendor applies the visibility predicate." Strict reading
  would also drop `dev-dependencies` from vendored output (the predicate
  excludes them by definition). Phase 3 preserved today's behavior
  (vendor copies both groups) and only filtered `publish: false`. Need
  sir's call on whether to tighten. Probably needs a design pass first
  to confirm vendor's audience (own-repo freeze vs distribution to
  outside consumers).

- [ ] **Consolidate `describeType(value)` helper.** The same
  null/array/typeof pattern appears at `manifest.ts:70`, `parseSourceEntry:124`,
  and the new `describeType` introduced in Carbon Phase 1. Reasonable
  cleanup — extract to a shared internal helper in `core/types-utils.ts`
  or similar.

- [ ] **`!negation` patterns in `IgnoreMatcher`.** Phase 3 deliberately
  skipped negation to keep the matcher minimal. Add if a real `exclude:`
  or `.skilltreeignore` use case surfaces that needs to opt-back-in.

- [ ] **Soft warning on `publish: false` in dev-dependencies.** Allowed
  today (redundant — dev-deps are already hidden), but a `skilltree check`
  hint might prevent confusion.

## Deferred from issue #23 (CLI flag consistency)

The non-breaking subset of issue #23 shipped in PRs PM1–PM4. The items
below need either design discussion or a major-version bump and were
deliberately left for a future cycle.

### Breaking changes (queue for next major)

- [ ] **`-f, --force` short-flag overload** — today `-f` means three
  different things (overwrite local files in `install`, skip confirmation
  in `remove`, discard modified files in `unvendor`). Remap so `-f,
  --force` only ever means "clobber files on disk", and migrate `remove`'s
  "skip confirmation" to `-y, --yes` (which is the conventional Unix
  meaning and already used by `init` and `add`). Requires a deprecation
  cycle: accept both for one major, warn on the deprecated form.

- [ ] **Rename `registry add --name` to `--as`** — disambiguates from
  "the thing's name." Same deprecation cycle: accept both, warn on `--name`.

- [ ] **Pick canonical positional name for the agent enum** — `targets
  add <target>` and `teach --agent <name>` accept the same set of values
  (`getKnownAgentNames()`). One should rename to match the other; issue
  #23 suggests `<agent>` since `AGENT_REGISTRY` is the source of truth.
  Update PROJECTS.md commands documentation when this lands.

- [ ] **`add -D, --dev` symmetric `remove --dev`** — today `remove foo`
  silently searches both groups. Add `--dev` for explicit disambiguation
  if a future state has a same-named entry in both groups. Low priority
  — flagging for awareness.

### Design questions (premise needs discussion before code)

- [ ] **`info --global`** — issue #23's premise was that `info` inspects
  project state, but it actually queries registry indexes. Real ask seems
  to be "show install status across project + global manifests." That's a
  feature, not a flag — needs a design pass on what `info <name>` should
  return when the entity is installed locally vs globally vs only in a
  registry vs nowhere.

- [ ] **`update --frozen`** — semantically overlaps with the existing
  `--dry-run` on `update`. Issue #23 itself describes it as "effectively
  a no-op verification." If we want a distinct verb, decide whether
  `--frozen` means "exit 1 if any version would actually update" (a
  CI-shaped check) and document the difference vs `--dry-run`.

### Pre-existing bugs surfaced during PM1

- [ ] **`cache clean` swallows real errors** — both human-mode ("Cache
  is already clean") and `--json` mode (`{cleaned: false, bytesFreed: 0}`)
  silently lie when `rm` fails partway (e.g. one sub-file with bad perms).
  Distinguish ENOENT from EPERM/EACCES and either re-raise the real error
  or report best-effort `bytesFreed` regardless of `cleaned`.

## Stale

(none)
