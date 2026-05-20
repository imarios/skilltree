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

- **Oxygen** (05/19/2026 → 05/19/2026): Skill packs — `packs:` section in `skilltree.yml`, `PackDependency` references (local + remote), full-entry members supporting multi-repo composition, all-or-nothing v1, nested-packs door left open. Shipped across 4 phases (types + manifest, resolver Phase 1.5, add/remove/registry surface, docs + e2e). 86 new tests, 4 commits. See [docs/specs/packs.md](specs/packs.md).

- **Nitrogen** (05/17/2026 → 05/18/2026): Preflight doctor + resolver error attribution — Phases 1–3 shipped `skilltree doctor` (manifest schema, lint, lockfile sync, target consistency, registry reachability, frontmatter; text + `--json` + `--global`) resolving #84. Phase 4 extended the same diagnostics philosophy to runtime resolver errors: every error names the manifest that imposed the constraint and the dep involved, resolving #85. Part of Authoring UX v1 (#78).
