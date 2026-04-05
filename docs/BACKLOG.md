# Backlog

## Must-Do Soon

- [ ] **R10a: Stale target detection** — `skilltree install` should warn when lockfile records `install_targets` that are no longer in the manifest (e.g., user removed codex). No auto-deletion. Message: `stale target .codex/ still has installed skills — run skilltree clean .codex to remove`. Low effort, should be next.

- [ ] **R19: Vendor single-target guard** — `skilltree vendor` should error when `install_targets` has multiple entries without `--target <name>` to select one. Currently vendor uses `getDevInstallPath()` and ignores `install_targets` entirely. Medium effort (vendor command + CLI flag + test).

## Nice-to-Have

- [ ] **R17-R18: Global manifest `--global` flag for targets** — The `targets` subcommand functions accept `global` in opts but the CLI doesn't wire `--global`. Low effort, just CLI wiring + tests.

- [ ] **R21: Teach as global dep** — Rewrite `teach` to use `add --global` + `install --global` so the skilltree skill is a proper global dependency with lockfile tracking. Requires solving: bundled skill source isn't in a git repo. Medium-high effort.

- [ ] **Migration guide** — Standalone document explaining `dev_install_path` → `install_targets` migration for existing projects. Mention `skilltree targets migrate` command. Low effort.

## Stale

(none)
