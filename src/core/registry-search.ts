import type { EntityType, IndexEntry, RegistryIndex } from "../types.js";

export interface SearchResult extends IndexEntry {
	registry: string;
	repo: string;
	score: number;
}

export interface SearchOptions {
	registry?: string;
	type?: EntityType;
}

/**
 * Search across registry indexes for entities matching a query.
 * Tokenizes the query, applies AND semantics, scores and sorts results.
 */
export function searchRegistries(
	query: string,
	indexes: RegistryIndex[],
	options?: SearchOptions,
): SearchResult[] {
	const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
	const results: SearchResult[] = [];

	for (const index of indexes) {
		if (options?.registry && index.registry !== options.registry) continue;

		for (const entity of index.entities) {
			if (options?.type && entity.type !== options.type) continue;

			if (tokens.length === 0) {
				// Empty query = browse mode: return all entities with score 0
				results.push({ ...entity, registry: index.registry, repo: index.repo, score: 0 });
			} else {
				const score = scoreEntity(tokens, entity);
				if (score > 0) {
					results.push({ ...entity, registry: index.registry, repo: index.repo, score });
				}
			}
		}
	}

	results.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		return a.name.localeCompare(b.name);
	});

	return results;
}

/**
 * Score a single entity against query tokens.
 * Returns 0 if any token has no match (AND semantics).
 */
export function scoreEntity(tokens: string[], entity: IndexEntry): number {
	const nameLower = entity.name.toLowerCase();
	const descLower = (entity.description ?? "").toLowerCase();
	const tagsLower = (entity.tags ?? []).map((t) => t.toLowerCase());
	const fullQuery = tokens.join(" ");

	let totalScore = 0;

	for (const token of tokens) {
		let tokenScore = 0;

		// Exact full-query name match (highest)
		if (nameLower === fullQuery) {
			tokenScore += 100;
		}
		// Name contains token
		if (nameLower.includes(token)) {
			tokenScore += 10;
		}
		// Tag exact match
		if (tagsLower.includes(token)) {
			tokenScore += 5;
		}
		// Description contains token (skip very short tokens to avoid false positives like "go" matching "Cargo")
		if (token.length >= 3 && descLower.includes(token)) {
			tokenScore += 1;
		}

		// AND semantics: if this token matched nothing, exclude entity
		if (tokenScore === 0) return 0;

		totalScore += tokenScore;
	}

	return totalScore;
}
