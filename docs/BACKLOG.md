# Backlog

## Must-Do Soon

- [x] **R10a: Stale target detection** — `skilltree install` warns when lockfile records `install_targets` no longer in manifest. → Fixed.

- [x] **R19: Vendor single-target guard** — `skilltree vendor` errors when `install_targets` has multiple entries without `--target <name>`. → Fixed.

## Nice-to-Have

- [x] **R17-R18: Global manifest `--global` flag for targets** — CLI wiring for `--global` on all targets subcommands. → Fixed.

- [x] **R21: Teach as global dep** — `teach` now uses `addCommand` + `installCommand` internally. Skilltree skill appears in global lockfile. → Fixed in Phase 6.

- [x] **Migration guide** — Documented in commands.md under `targets migrate`. → Fixed.

## Stale

(none)
