import { DEFAULT_TTL_MS, readRegistryIndex } from "../core/registry-cache.js";
import { listRegistries } from "../core/registry-config.js";
import { searchRegistries } from "../core/registry-search.js";
import { dim, pc, warn } from "../core/ui.js";
import type { EntityType, RegistryIndex } from "../types.js";

export interface SearchCommandOptions {
	registry?: string;
	type?: EntityType;
	json?: boolean;
}

/**
 * `skilltree search <query>`
 */
export async function searchCommand(
	query: string,
	opts: SearchCommandOptions,
	configPath?: string,
	cacheDir?: string,
): Promise<void> {
	const registries = await listRegistries(configPath);

	if (registries.length === 0) {
		throw new Error("No registries configured. Run 'skilltree registry add <url>' to add one.");
	}

	// Load indexes, skipping never-updated registries
	const indexes: RegistryIndex[] = [];
	for (const reg of registries) {
		// Skip registries not targeted by --registry
		if (opts.registry && reg.name !== opts.registry) continue;

		const index = await readRegistryIndex(reg.name, cacheDir);
		if (!index) {
			warn(
				`Skipping registry '${reg.name}' (never updated). Run ${pc.cyan(`'skilltree registry update ${reg.name}'`)} first.`,
			);
			continue;
		}
		// Inline staleness check to avoid re-reading the index file
		const indexAge = Date.now() - new Date(index.updated_at).getTime();
		if (indexAge > DEFAULT_TTL_MS) {
			warn(
				`Registry '${reg.name}' may be stale. Run ${pc.cyan(`'skilltree registry update ${reg.name}'`)} for latest.`,
			);
		}
		indexes.push(index);
	}

	if (indexes.length === 0) {
		throw new Error("No registry indexes available. Run 'skilltree registry update' first.");
	}

	const results = searchRegistries(query, indexes, {
		registry: opts.registry,
		type: opts.type,
	});

	if (opts.json) {
		console.log(JSON.stringify(results, null, 2));
		return;
	}

	if (results.length === 0) {
		throw new Error(`No results for "${query}".`);
	}

	// Format results
	const nameW = Math.max(4, ...results.map((r) => r.name.length));
	const typeW = Math.max(4, ...results.map((r) => r.type.length));
	const regW = Math.max(8, ...results.map((r) => r.registry.length));

	console.log(
		`Found ${pc.bold(String(results.length))} result${results.length === 1 ? "" : "s"}:\n`,
	);

	for (const r of results) {
		const desc = r.description ? `  ${dim(r.description)}` : "";
		console.log(
			`  ${pc.bold(r.name.padEnd(nameW))}  ${dim(r.type.padEnd(typeW))}  ${dim(r.registry.padEnd(regW))}${desc}`,
		);
		console.log(`  ${pc.cyan(`→ skilltree add ${r.name} --repo ${r.repo} --path ${r.path}`)}`);
		console.log();
	}
}
