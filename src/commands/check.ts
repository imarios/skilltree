import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { isSingleFileEntity } from "../core/entity-type.js";
import { validateFrontmatter } from "../core/frontmatter.js";
import type { ResolvedEntity } from "../core/graph.js";
import { resolveAll } from "../core/graph.js";
import { loadManifestOrThrow } from "../core/manifest.js";
import { expandTilde } from "../core/paths.js";
import { dim, pc, warn } from "../core/ui.js";
import type { Dependency, EntityType, Manifest } from "../types.js";
import { isLocalDependency } from "../types.js";

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
	const frontmatter = await lintLocalFrontmatter(manifest, dir);

	for (const w of warnings) {
		warn(w);
	}
	for (const w of frontmatter.warnings) {
		warn(w);
	}
	for (const n of frontmatter.notes) {
		console.log(dim(`  ${n}`));
	}

	const issueCount = warnings.length + frontmatter.warnings.length;
	if (issueCount === 0) {
		console.log(pc.green("✔ No issues."));
		return;
	}

	console.log(
		pc.dim(
			`\n${issueCount} issue${issueCount === 1 ? "" : "s"} found. ` +
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

/**
 * Walk every `local:` dependency in the manifest, load the entity's
 * `.md` file, and validate its YAML frontmatter against the documented
 * shape. Issue #83 / Authoring UX v1 (#78).
 *
 * Local-only by design: remote entries are someone else's authoring
 * artifact, and the lint runs at design time before remote caches are
 * even guaranteed to be present. Remote validation belongs in `verify`,
 * not `check`.
 *
 * Returns warnings (`warn(...)`, counts toward `--strict`) separately
 * from notes (`dim(...)`, never gates strict) so the caller can route
 * them to the right output channel.
 */
export async function lintLocalFrontmatter(
	manifest: Manifest,
	projectDir: string,
): Promise<{ warnings: string[]; notes: string[] }> {
	const warnings: string[] = [];
	const notes: string[] = [];

	const groups: Array<Record<string, Dependency> | undefined> = [
		manifest.dependencies,
		manifest["dev-dependencies"],
	];

	for (const deps of groups) {
		if (!deps) continue;
		for (const [key, dep] of Object.entries(deps)) {
			if (!isLocalDependency(dep)) continue;
			await lintOneLocalEntry(key, dep, projectDir, warnings, notes);
		}
	}

	return { warnings, notes };
}

async function lintOneLocalEntry(
	manifestKey: string,
	dep: { local: string; type?: EntityType; name?: string },
	projectDir: string,
	warnings: string[],
	notes: string[],
): Promise<void> {
	const expandedLocal = expandTilde(dep.local);
	const localPath = isAbsolute(expandedLocal) ? expandedLocal : join(projectDir, expandedLocal);
	const entityName = dep.name ?? manifestKey;

	// Resolve to the actual `.md` we need to read. We trust `dep.type` when
	// provided; otherwise we probe the filesystem (skill = dir/SKILL.md,
	// agent/command = .md file).
	const resolved = await resolveEntityMdPath(localPath, dep.type);
	if (resolved.kind === "missing") {
		warnings.push(`${displayPath(resolved.path, projectDir)}: local path does not exist`);
		return;
	}

	let content: string;
	try {
		content = await readFile(resolved.path, "utf-8");
	} catch {
		warnings.push(`${displayPath(resolved.path, projectDir)}: local path does not exist`);
		return;
	}

	const issues = validateFrontmatter(content, { entityName });
	const prefix = displayPath(resolved.path, projectDir);
	for (const issue of issues) {
		const line = `${prefix}: ${issue.message}`;
		if (issue.kind === "note") notes.push(line);
		else warnings.push(line);
	}
}

/**
 * Resolve a `local:` path to the actual `.md` file we should lint.
 * Skills are directories with `SKILL.md`; agents and commands are single
 * `.md` files. When `type` is omitted, probe the filesystem.
 */
async function resolveEntityMdPath(
	localPath: string,
	declaredType: EntityType | undefined,
): Promise<{ kind: "found" | "missing"; path: string }> {
	// Explicit `!== undefined` (not `!declaredType`): a future EntityType
	// value of `""` shouldn't silently fall through to filesystem probing.
	// See "Presence check ≠ value check" in CLAUDE.md.
	if (declaredType !== undefined) {
		const target = isSingleFileEntity(declaredType) ? localPath : join(localPath, "SKILL.md");
		try {
			await stat(target);
			return { kind: "found", path: target };
		} catch {
			return { kind: "missing", path: target };
		}
	}

	// No declared type — probe. Directory ⇒ skill (look for SKILL.md);
	// `.md` file ⇒ single-file entity (agent or command, both lint identically).
	try {
		const stats = await stat(localPath);
		if (stats.isDirectory()) {
			const skillMd = join(localPath, "SKILL.md");
			try {
				await stat(skillMd);
				return { kind: "found", path: skillMd };
			} catch {
				return { kind: "missing", path: skillMd };
			}
		}
		if (stats.isFile() && localPath.endsWith(".md")) {
			return { kind: "found", path: localPath };
		}
		// File of unknown shape — surface as missing so the author sees the
		// path that confused the linter.
		return { kind: "missing", path: localPath };
	} catch {
		return { kind: "missing", path: localPath };
	}
}

/** Render `localPath` relative to the project root when possible. */
function displayPath(absPath: string, projectDir: string): string {
	const rel = relative(projectDir, absPath);
	// `relative()` produces `..` segments when `absPath` is outside the
	// project; in that case fall back to the absolute form for clarity.
	if (rel === "" || rel.startsWith("..")) return absPath;
	return rel;
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
