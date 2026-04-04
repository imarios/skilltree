import semver from "semver";

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
 * Returns the resolved version or an error describing incompatible constraints.
 */
export function resolveIntersection(
	tags: string[],
	constraints: Array<{ name: string; constraint: string }>,
): { tag: string; version: string } | { error: string } {
	const semverTags = filterSemverTags(tags);

	if (semverTags.length === 0) {
		return { error: "No semver tags found" };
	}

	// Find tags satisfying all constraints
	for (const entry of semverTags) {
		const allSatisfied = constraints.every(
			(c) => c.constraint === "*" || semver.satisfies(entry.version, c.constraint),
		);
		if (allSatisfied) {
			return entry;
		}
	}

	const constraintDesc = constraints.map((c) => `${c.name} requires ${c.constraint}`).join("\n  ");
	return {
		error: `Incompatible version constraints:\n  ${constraintDesc}\n\nNo git tag satisfies all constraints.`,
	};
}
