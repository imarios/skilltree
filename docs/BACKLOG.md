# Backlog

## Must-Do Soon

- [x] **R10a: Stale target detection** — `skilltree install` warns when lockfile records `install_targets` no longer in manifest. → Fixed.

- [x] **R19: Vendor single-target guard** — `skilltree vendor` errors when `install_targets` has multiple entries without `--target <name>`. → Fixed.

## Nice-to-Have

- [x] **R17-R18: Global manifest `--global` flag for targets** — CLI wiring for `--global` on all targets subcommands. → Fixed.

- [ ] **R21: Teach as global dep** — Rewrite `teach` to use `add --global` + `install --global` so the skilltree skill is a proper global dependency with lockfile tracking. Requires solving: bundled skill source isn't in a git repo. Medium-high effort.

- [x] **Migration guide** — Documented in commands.md under `targets migrate`. → Fixed.

## Stale

(none)
