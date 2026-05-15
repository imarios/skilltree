import type { ResolvedEntity } from "../core/graph.js";
import { resolveAll } from "../core/graph.js";
import { loadManifestOrThrow } from "../core/manifest.js";
import { pc, warn } from "../core/ui.js";

export interface CheckOptions {
	strict?: boolean;
}

/**
 * Design-time lints for a skilltree project.
 *
 * Currently lints for one issue: a publicly-published entity that depends
 * (directly or transitively) on a same-repo `publish: false` entity. The
 * maintainer's own install succeeds, but downstream consumers fail at
 * install time when they hit the transitive `publish: false`.
 *
 * Spec: docs/specs/publication_surface.md §PS23–PS26.
 */
export async function checkCommand(dir: string, opts: CheckOptions = {}): Promise<void> {
	const manifest = await loadManifestOrThrow(dir);
	const result = await resolveAll(manifest, dir);

	const warnings = lintAsymmetricPublish(result.entities);

	for (const w of warnings) {
		warn(w);
	}

	if (warnings.length === 0) {
		console.log(pc.green("✔ No issues."));
		return;
	}

	console.log(
		pc.dim(
			`\n${warnings.length} issue${warnings.length === 1 ? "" : "s"} found. ` +
				`Re-run with --strict to fail the command on warnings.`,
		),
	);

	if (opts.strict) {
		process.exit(1);
	}
}

/**
 * Build a name → entity index over LOCAL entities only, then walk each
 * publicly-visible root through the graph's `entity.dependencies` (the
 * frontmatter dep list). Any same-repo `publish: false` reachable from a
 * `publish !== false` root is a leak — record the chain.
 *
 * Same-repo means another `local: true` entity. Remote deps are out of
 * scope here; Phase 4's origin-manifest lookup handles those at install.
 */
export function lintAsymmetricPublish(entities: Map<string, ResolvedEntity>): string[] {
	const localByName = new Map<string, ResolvedEntity>();
	for (const e of entities.values()) {
		if (e.local) localByName.set(e.name, e);
	}

	const warnings: string[] = [];
	for (const root of localByName.values()) {
		if (root.publish === false) continue;
		if (root.group !== "prod") continue;
		for (const chain of findHiddenChains(root, localByName)) {
			warnings.push(formatChain(chain));
		}
	}
	return warnings;
}

/**
 * BFS from `root` through same-repo local entities. Each `publish: false`
 * leaf produces one chain (the path from root to it). Chains terminate at
 * the first `publish: false` they reach — no need to traverse deeper, the
 * leak is already identified.
 */
function findHiddenChains(
	root: ResolvedEntity,
	localByName: Map<string, ResolvedEntity>,
): ResolvedEntity[][] {
	const chains: ResolvedEntity[][] = [];
	const visited = new Set<string>([root.name]);
	const queue: Array<{ node: ResolvedEntity; path: ResolvedEntity[] }> = [
		{ node: root, path: [root] },
	];

	while (queue.length > 0) {
		const frame = queue.shift();
		if (!frame) break;
		for (const depName of frame.node.dependencies) {
			const dep = localByName.get(depName);
			if (!dep) continue; // Remote or unresolved — out of scope.
			const nextPath = [...frame.path, dep];
			if (dep.publish === false) {
				chains.push(nextPath);
				continue;
			}
			if (visited.has(dep.name)) continue;
			visited.add(dep.name);
			queue.push({ node: dep, path: nextPath });
		}
	}
	return chains;
}

function formatChain(chain: ResolvedEntity[]): string {
	const root = chain[0];
	const leak = chain[chain.length - 1];
	if (!root || !leak) return "";
	const lines = [
		`'${root.name}' is published but depends (transitively) on '${leak.name}' (publish: false).`,
		"",
	];
	for (let i = 0; i < chain.length; i++) {
		const e = chain[i];
		if (!e) continue;
		const indent = "  ".repeat(i + 1);
		const tag = e.publish === false ? "publish: false" : "published";
		const marker = e.publish === false ? pc.yellow("  ← blocks downstream consumers") : "";
		lines.push(`${indent}${i === 0 ? "" : "→ "}${e.name} (${tag})${marker}`);
	}
	lines.push("");
	lines.push(
		`Downstream consumers will fail to resolve '${leak.name}'.`,
		`Fix: publish '${leak.name}' (remove publish: false) or drop the dependency chain.`,
	);
	return lines.join("\n");
}
