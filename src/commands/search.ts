import { DEFAULT_TTL_MS, loadFreshRegistryIndex } from "../core/registry-cache.js";
import { assertKnownRegistry, listRegistries } from "../core/registry-config.js";
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

	// Validate the registry name before the empty-list check so a typo'd
	// --registry surfaces as "registry 'X' not found" (which itself reports
	// the empty-list case) rather than the generic "no registries
	// configured" — the typo'd flag is the more precise signal.
	assertKnownRegistry(opts.registry, registries);
	if (registries.length === 0) {
		throw new Error("No registries configured. Run 'skilltree registry add <url>' to add one.");
	}

	// Load indexes, skipping never-updated registries
	const indexes: RegistryIndex[] = [];
	for (const reg of registries) {
		// Skip registries not targeted by --registry
		if (opts.registry && reg.name !== opts.registry) continue;

		// Fingerprint-aware load: a cache produced by a logically-incompatible
		// scanner (issue #25) returns null here, same as missing — both fix
		// with `skilltree registry update`.
		const index = await loadFreshRegistryIndex(reg.name, cacheDir);
		if (!index) {
			warn(
				`Skipping registry '${reg.name}' (never updated or outdated cache). Run ${pc.cyan(`'skilltree registry update ${reg.name}'`)} first.`,
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

	// Format results — display "pack" for kind=pack entries instead of the
	// placeholder `type: skill` carried in the index for schema reasons
	// (registries.md, Oxygen). The install hint also branches per kind so
	// packs suggest `--pack` instead of the misleading `--path pack:<name>`.
	const labelFor = (r: { type: string; kind?: "entity" | "pack" }): string =>
		r.kind === "pack" ? "pack" : r.type;
	const nameW = Math.max(4, ...results.map((r) => r.name.length));
	const typeW = Math.max(4, ...results.map((r) => labelFor(r).length));
	const regW = Math.max(8, ...results.map((r) => r.registry.length));

	console.log(
		`Found ${pc.bold(String(results.length))} result${results.length === 1 ? "" : "s"}:\n`,
	);

	for (const r of results) {
		const desc = r.description ? `  ${dim(r.description)}` : "";
		console.log(
			`  ${pc.bold(r.name.padEnd(nameW))}  ${dim(labelFor(r).padEnd(typeW))}  ${dim(r.registry.padEnd(regW))}${desc}`,
		);
		const installHint =
			r.kind === "pack"
				? `→ skilltree add ${r.name} --pack --repo ${r.repo}`
				: `→ skilltree add ${r.name} --repo ${r.repo} --path ${r.path}`;
		console.log(`  ${pc.cyan(installHint)}`);
		console.log();
	}
}
