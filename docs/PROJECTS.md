# Projects

Project Naming Theme: Elements

## Active Projects

- **Hydrogen** (03/29/2026): Core dependency manager — manifest, git resolution, installation, lifecycle, scanner, distribution

- **Helium** (03/30/2026): Spec compliance — lockfile-first install, --frozen, manifest validation, update/remove fixes

- **Lithium** (03/30/2026): Registries and discovery — registry management, search, info, registry-assisted `add`, `skilltree-index.yml` (originally shipped as `skillkit-index.yaml`)

- **Beryllium** (04/04/2026): Multi-agent support — `install_targets` for deploying to multiple agents, agent registry, `teach` auto-detection

- **Boron** (04/21/2026): Origin-manifest resolution for direct deps — `path:` optional when origin declares the name, redundancy/override warnings, `force_path` opt-out, `skilltree add --path` optional

- **Carbon** (05/14/2026): Publication surface — `skilltree.yml` as registry-index fallback, `publish: false` for WIP local entities, `exclude:` + `.skilltreeignore` for file-level trim, unified visibility predicate across indexing/vendor/origin-manifest lookup, `check` lint for asymmetric publish state (resolves #63)

## Completed Projects

- **Nitrogen** (05/17/2026 → 05/17/2026): Preflight doctor — `skilltree doctor` command bundling manifest schema, lint, lockfile sync, target consistency, registry reachability, and frontmatter checks; text + `--json` output; `--global` flag (resolves #84, part of Authoring UX v1 #78)
