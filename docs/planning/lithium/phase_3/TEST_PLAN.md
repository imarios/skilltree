# Lithium Phase 3: Registry-Assisted Add - Test Plan

## `tests/commands/add-registry.test.ts`

**Registry-assisted add (no --repo/--source/--local):**
- [ ] resolves from registry and writes full form to manifest
- [ ] errors when no registries configured
- [ ] errors when name not found in any registry
- [ ] errors when registry indexes not available (never updated)
- [ ] uses --registry flag to filter to one registry
- [ ] still works with explicit --repo (registries not consulted)
- [ ] still works with --local (registries not consulted)
