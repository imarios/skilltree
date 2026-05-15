import type { Dependency } from "../types.js";

/**
 * Publication-surface visibility predicate (spec PS1).
 *
 * Single source of truth for "is this entity exposed to consumers?" Called
 * from every consumer-facing code path: registry indexing, registry-index
 * generation, vendor, origin-manifest lookup.
 *
 * An entity is publicly visible iff:
 *   1. It is in `dependencies` (not `dev-dependencies`), AND
 *   2. Its `publish` field is not explicitly `false`.
 *
 * `publish` is only meaningful on local entries; on remote entries the field
 * doesn't exist and the predicate falls through to the group check alone.
 *
 * See docs/specs/publication_surface.md for the full spec.
 */
export function isPubliclyVisible(
	entry: Dependency,
	group: "dependencies" | "dev-dependencies",
): boolean {
	if (group !== "dependencies") return false;
	// `publish` lives on LocalDependency only, but TypeScript's union narrowing
	// would require a type guard here. A bare lookup is cheaper and equivalent.
	const publish = (entry as { publish?: boolean }).publish;
	return publish !== false;
}
