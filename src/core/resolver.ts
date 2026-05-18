import semver from "semver";

/**
 * Identifies which manifest imposed a version constraint. Used to attribute
 * resolver errors back to the file the author can edit (#85, Nitrogen Phase 4).
 */
export type ConstraintSource =
	| { kind: "consumer"; manifestPath: string }
	| { kind: "transitive"; originRepo: string; ref: string };

/**
 * One version constraint with attribution. `name` is the dep yaml key; `source`
 * names the manifest that declared the constraint.
 */
export interface Constraint {
	name: string;
	constraint: string;
	source: ConstraintSource;
}

/**
 * Render a ConstraintSource for inclusion in user-facing error messages.
 * Consumer manifests show as the relative path; transitive sources show as
 * `<repo>@<short-ref>` so the author can locate the offending upstream
 * skilltree.yml.
 */
export function formatConstraintSource(source: ConstraintSource): string {
	if (source.kind === "consumer") {
		return source.manifestPath;
	}
	const ref = source.ref.length > 12 ? source.ref.slice(0, 7) : source.ref;
	return `${source.originRepo}@${ref}`;
}

/**
 * Parse a git tag into a semver version, stripping optional `v` prefix.
 * Returns null if the tag is not valid semver.
 */
export function parseTag(tag: string): string | null {
	const cleaned = tag.startsWith("v") ? tag.slice(1) : tag;
	return semver.valid(cleaned);
}

/**
 * Filter tags to only valid semver versions.
 * Returns sorted array of {tag, version} pairs (descending).
 */
export function filterSemverTags(tags: string[]): Array<{ tag: string; version: string }> {
	const parsed: Array<{ tag: string; version: string }> = [];

	for (const tag of tags) {
		const version = parseTag(tag);
		if (version) {
			parsed.push({ tag, version });
		}
	}

	return parsed.sort((a, b) => semver.rcompare(a.version, b.version));
}

/**
 * Find the highest tag satisfying a version constraint.
 * Returns the matching {tag, version} or null.
 */
export function resolveConstraint(
	tags: string[],
	constraint: string,
): { tag: string; version: string } | null {
	const semverTags = filterSemverTags(tags);

	if (semverTags.length === 0) {
		return null;
	}

	// "*" matches any version — return highest
	if (constraint === "*") {
		return semverTags[0] ?? null;
	}

	for (const entry of semverTags) {
		if (semver.satisfies(entry.version, constraint)) {
			return entry;
		}
	}

	return null;
}

/**
 * Intersect multiple version constraints and find the highest satisfying tag.
 * Returns the resolved version or an error attributing each constraint to the
 * manifest that imposed it.
 */
export function resolveIntersection(
	tags: string[],
	constraints: Constraint[],
): { tag: string; version: string } | { error: string } {
	const semverTags = filterSemverTags(tags);

	if (semverTags.length === 0) {
		return { error: "No semver tags found" };
	}

	for (const entry of semverTags) {
		const allSatisfied = constraints.every(
			(c) => c.constraint === "*" || semver.satisfies(entry.version, c.constraint),
		);
		if (allSatisfied) {
			return entry;
		}
	}

	const lines = constraints.map(
		(c) => `  ${formatConstraintSource(c.source)} requires ${c.name} ${c.constraint}`,
	);
	return {
		error: `Incompatible version constraints:\n${lines.join("\n")}\n\nNo git tag satisfies all constraints.`,
	};
}
