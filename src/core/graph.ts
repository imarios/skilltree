import { readFile, stat } from "node:fs/promises";
import simpleGit from "simple-git";
import type {
	Dependency,
	DependencyGroup,
	EntityType,
	LocalDependency,
	Manifest,
} from "../types.js";
import { isLocalDependency, isRemoteDependency } from "../types.js";
import { getDeclaredDeps, parseFrontmatter } from "./frontmatter.js";
import {
	ensureCached,
	getCommitSha,
	getDefaultBranch,
	listTags,
	pathExistsAtRef,
	readFileAtRef,
} from "./git.js";
import { expandSources, parseManifest } from "./manifest.js";
import { expandTilde, stripDotSlash } from "./paths.js";
import { resolveIntersection } from "./resolver.js";

export interface ResolvedEntity {
	key: string; // YAML key (alias)
	name: string; // actual entity name
	type: EntityType;
	group: DependencyGroup;
	repo?: string;
	path: string;
	version?: string;
	tag?: string;
	commit: string;
	local: boolean;
	dependencies: string[];
	cachePath?: string;
	/** The source directory this entity came from (for same-origin resolution of local sources). */
	sourceDir?: string;
}

export interface ResolutionResult {
	entities: Map<string, ResolvedEntity>;
	errors: string[];
	warnings: string[];
	installOrder: string[];
}

interface RepoResolution {
	cachePath: string;
	tag?: string;
	version?: string;
	commit: string;
}

/** Shared state passed through the resolution process. */
interface ResolutionState {
	expanded: Manifest;
	projectDir: string;
	entities: Map<string, ResolvedEntity>;
	resolutionContext: Map<string, string>;
	repoResolutions: Map<string, RepoResolution>;
	manifestKeys: Set<string>;
	errors: string[];
	warnings: string[];
	/** depName -> origin repo URL, for informative error when a transitive dep
	 * is only in origin's dev-dependencies (not exposed to downstream consumers). */
	originDevDepHints: Map<string, string>;
}

export async function resolveAll(
	manifest: Manifest,
	projectDir: string,
): Promise<ResolutionResult> {
	const expanded = expandSources(manifest);

	const state: ResolutionState = {
		expanded,
		projectDir,
		entities: new Map(),
		resolutionContext: new Map(),
		repoResolutions: new Map(),
		manifestKeys: new Set([
			...Object.keys(expanded.dependencies ?? {}),
			...Object.keys(expanded["dev-dependencies"] ?? {}),
		]),
		errors: [],
		warnings: [],
		originDevDepHints: new Map(),
	};

	await resolveRepoVersions(expanded, state);
	await processDeps(expanded.dependencies, "prod", state);
	await processDeps(expanded["dev-dependencies"], "dev", state);
	validateTypeConstraints(state);

	const installOrder = topologicalSort(state.entities, state.resolutionContext, state.errors);

	return {
		entities: state.entities,
		errors: state.errors,
		warnings: state.warnings,
		installOrder,
	};
}

async function resolveRepoVersions(expanded: Manifest, state: ResolutionState): Promise<void> {
	const repoConstraints = new Map<string, Array<{ name: string; constraint: string }>>();

	for (const deps of [expanded.dependencies, expanded["dev-dependencies"]]) {
		if (!deps) continue;
		for (const [key, dep] of Object.entries(deps)) {
			if (isRemoteDependency(dep)) {
				const existing = repoConstraints.get(dep.repo) ?? [];
				existing.push({ name: key, constraint: dep.version ?? "*" });
				repoConstraints.set(dep.repo, existing);
			}
		}
	}

	for (const [repo, constraints] of repoConstraints) {
		await resolveOneRepo(repo, constraints, state);
	}
}

async function resolveOneRepo(
	repo: string,
	constraints: Array<{ name: string; constraint: string }>,
	state: ResolutionState,
): Promise<void> {
	try {
		const cachePath = await ensureCached(repo);
		const tags = await listTags(cachePath);

		const result = resolveIntersection(tags, constraints);
		if ("error" in result) {
			if (result.error === "No semver tags found") {
				await addTaglessRepoResolution(repo, cachePath, state);
			} else {
				state.errors.push(
					`Error: Incompatible version constraints for repo ${repo}\n\n  ${result.error}\n\nFix: Align version constraints, or move entities to separate repos.`,
				);
			}
			return;
		}

		const commit = await getCommitSha(cachePath, result.tag);
		state.repoResolutions.set(repo, {
			cachePath,
			tag: result.tag,
			version: result.version,
			commit,
		});
	} catch (e) {
		const errMsg = e instanceof Error ? e.message : String(e);
		try {
			const cachePath = await ensureCached(repo);
			await addTaglessRepoResolution(repo, cachePath, state);
		} catch {
			state.errors.push(
				`Error: Git operation failed\n\n  Failed to fetch ${repo}\n  Underlying error: ${errMsg}\n\nFix: Check the repo URL in skilltree.yaml and your git access (SSH keys, GITHUB_TOKEN).`,
			);
		}
	}
}

async function addTaglessRepoResolution(
	repo: string,
	cachePath: string,
	state: ResolutionState,
): Promise<void> {
	const defaultBranch = await getDefaultBranch(cachePath);
	const commit = await getCommitSha(cachePath, defaultBranch);
	state.warnings.push(
		`Warning: ${repo} has no version tags.\n  Using default branch (${defaultBranch}) at commit ${commit.slice(0, 7)}.\n  Consider adding semver tags (e.g., v1.0.0) for version control.`,
	);
	state.repoResolutions.set(repo, { cachePath, commit });
}

async function processDeps(
	deps: Record<string, Dependency> | undefined,
	defaultGroup: DependencyGroup,
	state: ResolutionState,
): Promise<void> {
	if (!deps) return;
	for (const [key, dep] of Object.entries(deps)) {
		const entityName = "name" in dep && dep.name ? (dep.name as string) : key;
		await resolveEntity(key, entityName, dep, defaultGroup, state);
	}
}

async function resolveEntity(
	yamlKey: string,
	entityName: string,
	dep: Dependency,
	group: DependencyGroup,
	state: ResolutionState,
): Promise<void> {
	if (isLocalDependency(dep)) {
		await resolveLocalEntity(yamlKey, entityName, dep, group, state);
	} else if (isRemoteDependency(dep)) {
		await resolveRemoteEntity(yamlKey, entityName, dep, group, state);
	}
}

function checkDuplicate(
	compositeKey: string,
	yamlKey: string,
	group: DependencyGroup,
	state: ResolutionState,
): boolean {
	if (!state.entities.has(compositeKey)) return false;

	const existing = state.entities.get(compositeKey);
	if (existing) {
		if (
			existing.key !== yamlKey &&
			state.manifestKeys.has(existing.key) &&
			state.manifestKeys.has(yamlKey)
		) {
			state.errors.push(
				`Error: Duplicate entity resolution\n\n  Both "${existing.key}" and "${yamlKey}" resolve to ${compositeKey}.\n\nFix: Use distinct names, or remove one entry.`,
			);
		}
		if (group === "prod" && existing.group === "dev") {
			existing.group = "prod";
		}
	}
	return true;
}

function registerEntity(entity: ResolvedEntity, state: ResolutionState): void {
	const compositeKey = `${entity.type}:${entity.name}`;
	state.entities.set(compositeKey, entity);
	const existingCtx = state.resolutionContext.get(entity.name);
	if (!existingCtx || entity.type === "skill") {
		state.resolutionContext.set(entity.name, compositeKey);
	}
}

async function readLocalFrontmatter(
	localPath: string,
	type: EntityType,
	entityName: string,
): Promise<string[]> {
	try {
		const skillMdPath = type === "skill" ? `${localPath}/SKILL.md` : localPath;
		const content = await readFile(skillMdPath, "utf-8");
		const fm = parseFrontmatter(content);
		return (fm ? getDeclaredDeps(fm) : []).filter((d) => d !== entityName);
	} catch {
		return [];
	}
}

async function readRemoteFrontmatter(
	cachePath: string,
	ref: string,
	entityPath: string,
	type: EntityType,
	entityName: string,
): Promise<string[]> {
	try {
		const skillMdFile = type === "skill" ? `${entityPath}/SKILL.md` : entityPath;
		const content = await readFileAtRef(cachePath, ref, stripDotSlash(skillMdFile));
		const fm = parseFrontmatter(content);
		return (fm ? getDeclaredDeps(fm) : []).filter((d) => d !== entityName);
	} catch {
		return [];
	}
}

async function resolveLocalEntity(
	yamlKey: string,
	entityName: string,
	dep: { local: string; type?: EntityType; name?: string; _sourceDir?: string },
	group: DependencyGroup,
	state: ResolutionState,
): Promise<void> {
	const expandedLocal = expandTilde(dep.local);
	const localPath = expandedLocal.startsWith("/")
		? expandedLocal
		: `${state.projectDir}/${expandedLocal}`;
	const type = dep.type ?? (await inferType(localPath));
	const compositeKey = `${type}:${entityName}`;

	if (checkDuplicate(compositeKey, yamlKey, group, state)) return;

	const frontmatterDeps = await readLocalFrontmatter(localPath, type, entityName);
	const entity: ResolvedEntity = {
		key: yamlKey,
		name: entityName,
		type,
		group,
		path: expandedLocal,
		commit: "HEAD",
		local: true,
		dependencies: frontmatterDeps,
		sourceDir: dep._sourceDir ? expandTilde(dep._sourceDir) : undefined,
	};

	registerEntity(entity, state);

	for (const transDepName of frontmatterDeps) {
		await resolveTransitive(transDepName, type, group, compositeKey, state);
	}
}

async function resolveRemoteEntity(
	yamlKey: string,
	entityName: string,
	dep: { repo: string; path: string; version?: string; type?: EntityType; name?: string },
	group: DependencyGroup,
	state: ResolutionState,
): Promise<void> {
	const resolution = state.repoResolutions.get(dep.repo);
	if (!resolution) return;

	const ref = resolution.tag ?? resolution.commit;
	let entityPath = dep.path;
	let type = dep.type;
	if (!type) {
		const inferred = await inferTypeFromGit(resolution.cachePath, ref, dep.path);
		type = inferred.type;
		entityPath = inferred.resolvedPath;
	}
	// Validate that the path actually exists at the resolved ref
	const normalizedPath = stripDotSlash(entityPath);
	const exists = await pathExistsAtRef(resolution.cachePath, ref, normalizedPath);
	if (!exists) {
		const refLabel = resolution.tag ?? resolution.commit.slice(0, 8);
		state.errors.push(
			`"${entityName}" not found at path "${entityPath}" in repo "${dep.repo}" at ${refLabel}. It may have been moved or removed.`,
		);
		return;
	}

	const compositeKey = `${type}:${entityName}`;

	if (checkDuplicate(compositeKey, yamlKey, group, state)) return;

	const frontmatterDeps = await readRemoteFrontmatter(
		resolution.cachePath,
		ref,
		entityPath,
		type,
		entityName,
	);

	const entity: ResolvedEntity = {
		key: yamlKey,
		name: entityName,
		type,
		group,
		repo: dep.repo,
		path: entityPath,
		version: resolution.version,
		tag: resolution.tag,
		commit: resolution.commit,
		local: false,
		dependencies: frontmatterDeps,
		cachePath: resolution.cachePath,
	};

	registerEntity(entity, state);

	for (const transDepName of frontmatterDeps) {
		await resolveTransitive(transDepName, type, group, compositeKey, state);
	}
}

async function resolveTransitive(
	depName: string,
	parentType: EntityType,
	parentGroup: DependencyGroup,
	parentCompositeKey: string,
	state: ResolutionState,
): Promise<void> {
	if (checkExistingResolution(depName, parentType, parentGroup, parentCompositeKey, state)) return;
	if (await tryResolveFromManifest(depName, parentGroup, state)) return;
	if (await tryResolveFromLocalSource(depName, parentGroup, parentCompositeKey, state)) return;
	if (await tryResolveFromOriginManifest(depName, parentGroup, parentCompositeKey, state)) return;
	if (await tryResolveFromSameRepo(depName, parentGroup, parentCompositeKey, state)) return;
	addUnresolvedError(depName, parentCompositeKey, state);
}

function checkExistingResolution(
	depName: string,
	parentType: EntityType,
	parentGroup: DependencyGroup,
	parentCompositeKey: string,
	state: ResolutionState,
): boolean {
	if (!state.resolutionContext.has(depName)) return false;

	const existingKey = state.resolutionContext.get(depName);
	if (existingKey) {
		const existing = state.entities.get(existingKey);
		if (existing && parentGroup === "prod" && existing.group === "dev") {
			existing.group = "prod";
		}
		if (parentType === "skill" && existing?.type === "agent") {
			state.errors.push(
				`Error: Invalid dependency type\n\n  skill:${state.entities.get(parentCompositeKey)?.name} cannot depend on agent:${depName}.\n  Skills can only depend on other skills.\n\nFix: Remove ${depName} from ${state.entities.get(parentCompositeKey)?.name}'s dependencies.`,
			);
		}
	}
	return true;
}

async function tryResolveFromManifest(
	depName: string,
	parentGroup: DependencyGroup,
	state: ResolutionState,
): Promise<boolean> {
	const allDeps = { ...state.expanded.dependencies, ...state.expanded["dev-dependencies"] };
	if (!(depName in allDeps)) return false;
	const dep = allDeps[depName];
	if (!dep) return false;
	const actualName = "name" in dep && dep.name ? (dep.name as string) : depName;
	await resolveEntity(depName, actualName, dep, parentGroup, state);
	return true;
}

async function tryResolveFromLocalSource(
	depName: string,
	parentGroup: DependencyGroup,
	parentCompositeKey: string,
	state: ResolutionState,
): Promise<boolean> {
	const parentEntity = state.entities.get(parentCompositeKey);
	if (!parentEntity?.sourceDir) return false;
	return resolveFromLocalSource(parentEntity.sourceDir, depName, parentGroup, state);
}

async function tryResolveFromOriginManifest(
	depName: string,
	parentGroup: DependencyGroup,
	parentCompositeKey: string,
	state: ResolutionState,
): Promise<boolean> {
	const parentEntity = state.entities.get(parentCompositeKey);
	if (!parentEntity?.repo) return false;

	const resolution = state.repoResolutions.get(parentEntity.repo);
	if (!resolution) return false;

	const ref = resolution.tag ?? resolution.commit;

	let manifestContent: string;
	try {
		manifestContent = await readFileAtRef(resolution.cachePath, ref, "skilltree.yaml");
	} catch {
		return false;
	}

	let originManifest: Manifest;
	try {
		originManifest = parseManifest(manifestContent);
	} catch {
		return false;
	}

	const expanded = expandSources(originManifest);
	const prodEntry = expanded.dependencies?.[depName];
	const devEntry = expanded["dev-dependencies"]?.[depName];

	if (!prodEntry) {
		if (devEntry) {
			state.originDevDepHints.set(depName, parentEntity.repo);
		}
		return false;
	}

	// Only `local:` entries are supported in this iteration. Cross-repo
	// (repo:/source:-expanded-to-repo) entries in origin's manifest fall
	// through to the conventional probe — full cross-repo transitive resolution
	// is a planned follow-up.
	if (!isLocalDependency(prodEntry)) {
		return false;
	}

	const localPath = stripDotSlash(prodEntry.local);
	const syntheticDep = {
		repo: parentEntity.repo,
		path: localPath,
		...(prodEntry.type ? { type: prodEntry.type } : {}),
		...(prodEntry.name ? { name: prodEntry.name } : {}),
	};

	const actualName = prodEntry.name ?? depName;
	await resolveEntity(depName, actualName, syntheticDep, parentGroup, state);
	return true;
}

async function tryResolveFromSameRepo(
	depName: string,
	parentGroup: DependencyGroup,
	parentCompositeKey: string,
	state: ResolutionState,
): Promise<boolean> {
	const parentEntity = state.entities.get(parentCompositeKey);
	if (!parentEntity?.repo) return false;

	const resolution = state.repoResolutions.get(parentEntity.repo);
	if (!resolution) return false;

	const ref = resolution.tag ?? resolution.commit;
	const candidates = [`skills/${depName}`, `agents/${depName}.md`, depName];

	for (const candidatePath of candidates) {
		try {
			const normalizedPath = stripDotSlash(candidatePath);
			await readFileAtRef(
				resolution.cachePath,
				ref,
				normalizedPath.endsWith(".md") ? normalizedPath : `${normalizedPath}/SKILL.md`,
			);
			const syntheticDep = {
				repo: parentEntity.repo,
				path: candidatePath,
				version: parentEntity.version,
			};
			await resolveEntity(depName, depName, syntheticDep, parentGroup, state);
			return true;
		} catch {
			// Not found at this path, try next
		}
	}
	return false;
}

function addUnresolvedError(
	depName: string,
	parentCompositeKey: string,
	state: ResolutionState,
): void {
	const parentEntity = state.entities.get(parentCompositeKey);
	const parentName = parentEntity?.name ?? parentCompositeKey;
	const parentSource = parentEntity?.repo ? `from ${parentEntity.repo}` : "local";
	state.errors.push(
		`${parentName} (${parentSource}) declares dependency "${depName}",\n     not found in: manifest, resolution context, or ${parentEntity?.repo ?? "local filesystem"}\n     Fix: skilltree add ${depName} --repo <repo-url> --path <path>`,
	);
}

async function resolveFromLocalSource(
	sourceDir: string,
	depName: string,
	group: DependencyGroup,
	state: ResolutionState,
): Promise<boolean> {
	const candidates: Array<{ path: string; type: EntityType }> = [
		{ path: `${sourceDir}/skills/${depName}`, type: "skill" },
		{ path: `${sourceDir}/agents/${depName}.md`, type: "agent" },
		{ path: `${sourceDir}/${depName}`, type: "skill" },
	];

	for (const candidate of candidates) {
		try {
			const stats = await stat(candidate.path);
			if (candidate.type === "skill" && stats.isDirectory()) {
				try {
					await stat(`${candidate.path}/SKILL.md`);
				} catch {
					continue;
				}
				const syntheticDep: LocalDependency = { local: candidate.path, _sourceDir: sourceDir };
				await resolveEntity(depName, depName, syntheticDep, group, state);
				return true;
			}
			if (candidate.type === "agent" && stats.isFile()) {
				const syntheticDep: LocalDependency = {
					local: candidate.path,
					type: "agent",
					_sourceDir: sourceDir,
				};
				await resolveEntity(depName, depName, syntheticDep, group, state);
				return true;
			}
		} catch {
			// Not found at this path, try next
		}
	}
	return false;
}

function validateTypeConstraints(state: ResolutionState): void {
	for (const [, entity] of state.entities) {
		if (entity.type !== "skill") continue;
		for (const depName of entity.dependencies) {
			const depKey = state.resolutionContext.get(depName);
			if (!depKey) continue;
			const dep = state.entities.get(depKey);
			if (dep?.type === "agent") {
				const errMsg = `Error: Invalid dependency type\n\n  skill:${entity.name} cannot depend on agent:${depName}.\n  Skills can only depend on other skills.\n\nFix: Remove ${depName} from ${entity.name}'s dependencies.`;
				if (!state.errors.includes(errMsg)) {
					state.errors.push(errMsg);
				}
			}
		}
	}
}

export function topologicalSort(
	entities: Map<string, ResolvedEntity>,
	resolutionContext: Map<string, string>,
	errors: string[],
): string[] {
	const { inDegree, adjacency } = buildGraph(entities, resolutionContext);
	const result = kahnSort(inDegree, adjacency);
	detectCycles(result, entities, errors);
	return result;
}

function buildGraph(
	entities: Map<string, ResolvedEntity>,
	resolutionContext: Map<string, string>,
): { inDegree: Map<string, number>; adjacency: Map<string, string[]> } {
	const inDegree = new Map<string, number>();
	const adjacency = new Map<string, string[]>();

	for (const key of entities.keys()) {
		inDegree.set(key, 0);
		adjacency.set(key, []);
	}

	for (const [compositeKey, entity] of entities) {
		for (const depName of entity.dependencies) {
			const depCompositeKey = resolutionContext.get(depName);
			if (depCompositeKey && entities.has(depCompositeKey)) {
				adjacency.get(depCompositeKey)?.push(compositeKey);
				inDegree.set(compositeKey, (inDegree.get(compositeKey) ?? 0) + 1);
			}
		}
	}

	return { inDegree, adjacency };
}

function kahnSort(inDegree: Map<string, number>, adjacency: Map<string, string[]>): string[] {
	const queue: string[] = [];
	for (const [key, degree] of inDegree) {
		if (degree === 0) queue.push(key);
	}
	queue.sort();

	const result: string[] = [];
	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) break;
		result.push(current);

		for (const dep of adjacency.get(current) ?? []) {
			const newDegree = (inDegree.get(dep) ?? 1) - 1;
			inDegree.set(dep, newDegree);
			if (newDegree === 0) {
				const insertIdx = queue.findIndex((q) => q > dep);
				if (insertIdx === -1) {
					queue.push(dep);
				} else {
					queue.splice(insertIdx, 0, dep);
				}
			}
		}
	}
	return result;
}

function detectCycles(
	result: string[],
	entities: Map<string, ResolvedEntity>,
	errors: string[],
): void {
	if (result.length >= entities.size) return;
	const resultSet = new Set(result);
	const cycleNodes = [...entities.keys()].filter((k) => !resultSet.has(k));
	const cycleNames = cycleNodes.map((k) => entities.get(k)?.name ?? k);
	errors.push(
		`Error: Circular dependency detected\n\n  ${cycleNames.join(" -> ")} -> ${cycleNames[0]}\n\nFix: Remove one of these dependency edges in the skill frontmatter.`,
	);
}

async function inferType(localPath: string): Promise<EntityType> {
	try {
		const stats = await stat(localPath);
		if (stats.isFile() && localPath.endsWith(".md")) return "agent";
		if (stats.isDirectory()) {
			try {
				await stat(`${localPath}/SKILL.md`);
			} catch {
				// Directory without SKILL.md — assume skill
			}
			return "skill";
		}
		return "skill";
	} catch {
		return "skill";
	}
}

export async function inferTypeFromGit(
	cachePath: string,
	ref: string,
	path: string,
): Promise<{ type: EntityType; resolvedPath: string }> {
	const normalizedPath = stripDotSlash(path);

	try {
		const entry = await findGitEntry(cachePath, ref, normalizedPath);
		if (!entry) return fallbackType(normalizedPath);

		if (entry.mode === "120000") {
			const target = await readFileAtRef(cachePath, ref, normalizedPath);
			return inferTypeFromGit(cachePath, ref, resolveSymlinkTarget(normalizedPath, target.trim()));
		}

		if (entry.objectType === "tree") {
			return { type: "skill", resolvedPath: normalizedPath };
		}

		if (entry.objectType === "blob" && entry.name.endsWith(".md")) {
			return { type: "agent", resolvedPath: normalizedPath };
		}

		return { type: "skill", resolvedPath: normalizedPath };
	} catch {
		try {
			const skillMdPath = normalizedPath === "." ? "SKILL.md" : `${normalizedPath}/SKILL.md`;
			await readFileAtRef(cachePath, ref, skillMdPath);
			return { type: "skill", resolvedPath: normalizedPath };
		} catch {
			return fallbackType(normalizedPath);
		}
	}
}

function fallbackType(path: string): { type: EntityType; resolvedPath: string } {
	return { type: path.endsWith(".md") ? "agent" : "skill", resolvedPath: path };
}

async function findGitEntry(
	cachePath: string,
	ref: string,
	normalizedPath: string,
): Promise<{ mode: string; objectType: string; name: string } | null> {
	const git = simpleGit(cachePath);

	const parentDir = normalizedPath.includes("/")
		? normalizedPath.slice(0, normalizedPath.lastIndexOf("/"))
		: ".";
	const entryName = normalizedPath.includes("/")
		? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1)
		: normalizedPath;

	const treeArg = parentDir === "." ? ref : `${ref}:${parentDir}`;
	const lsOutput = await git.raw(["ls-tree", treeArg]);

	for (const line of lsOutput.trim().split("\n")) {
		const match = line.match(/^(\d+)\s+(blob|tree)\s+[a-f0-9]+\t(.+)$/);
		if (match?.[3] === entryName) {
			return { mode: match[1] as string, objectType: match[2] as string, name: match[3] };
		}
	}
	return null;
}

function resolveSymlinkTarget(symlinkPath: string, target: string): string {
	if (!target.startsWith("..") && !target.startsWith("./")) return target;

	const parts = symlinkPath.split("/").slice(0, -1);
	for (const segment of target.split("/")) {
		if (segment === "..") {
			parts.pop();
		} else if (segment !== ".") {
			parts.push(segment);
		}
	}
	return parts.join("/");
}
