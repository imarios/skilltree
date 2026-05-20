import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import semver from "semver";
import simpleGit from "simple-git";
import type {
	Dependency,
	DependencyGroup,
	EntityType,
	LocalDependency,
	Manifest,
	PackDependency,
	PackMember,
} from "../types.js";
import { isLocalDependency, isPackDependency, isRemoteDependency } from "../types.js";
import { conventionalCandidates, isSingleFileEntity, mdFileType } from "./entity-type.js";
import { MANIFEST_NEW, MANIFEST_NEW_ALT } from "./filenames.js";
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
import { canonicalPath, expandTilde, stripDotSlash } from "./paths.js";
import type { Constraint, ConstraintSource } from "./resolver.js";
import { resolveIntersection } from "./resolver.js";

/**
 * Where a yaml key was declared — used to attribute collision errors (#85).
 * Consumer-manifest entries show as the relative path; transitive entries show
 * as `<repo>@<short-ref>` so the author can find the upstream skilltree.yml.
 */
export type EntityOrigin =
	| { kind: "consumer"; manifestPath: string }
	| { kind: "transitive"; originRepo: string; ref: string };

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
	/** Manifest that declared this yaml key. Set during resolution; consumed by
	 * collision-attribution and installer error messages. Optional for backward
	 * compat with helpers that construct partial entities for tests. */
	declaredIn?: EntityOrigin;
	/** The source directory this entity came from (for same-origin resolution of local sources). */
	sourceDir?: string;
	/**
	 * Publication-surface flag from the local manifest entry. Only meaningful
	 * for local entities. `false` → not exposed to consumers via indexing or
	 * vendor; still installed locally for the maintainer. See
	 * docs/specs/publication_surface.md §PS3, PS18, PS20.
	 */
	publish?: boolean;
	/**
	 * File-level trim patterns from the local manifest entry. Gitignore-style
	 * globs, relative to the entity root. Honored by the installer's copy
	 * path. Only meaningful for local entities; ignored for single-file types.
	 * See docs/specs/publication_surface.md §PS6, PS17, PS21.
	 */
	exclude?: string[];
	/**
	 * If this entity was injected by a pack expansion, the consumer's yaml key
	 * for that pack reference. Internal; never serialized to lockfile. Drives
	 * future `why <entity>` provenance ("via pack X"). Oxygen Phase 2.
	 */
	viaPack?: string;
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
	/**
	 * depName -> { repo, reason } for transitive deps that origin's manifest
	 * declares but marks as not exposed to downstream consumers. Two reasons:
	 *   - "dev-dependency": entry is in origin's `dev-dependencies` group
	 *   - "publish-false":  entry has `publish: false` in origin's `dependencies`
	 * Drives the actionable resolution-failure message at `addUnresolvedError`.
	 * Spec: publication_surface.md §PS15–PS16.
	 */
	originHiddenHints: Map<string, OriginHiddenHint>;
	/**
	 * Set during pack expansion (Phase 1.5). Maps the synthesized member's
	 * yaml key to the EntityOrigin that should be reported as `declaredIn`
	 * for the resolved entity. Consumed by `processDeps`. Oxygen Phase 2.
	 */
	packMemberOrigin: Map<string, EntityOrigin>;
	/**
	 * Set during pack expansion. Maps the synthesized member's yaml key to
	 * the consumer's yaml key for the pack that injected it. Used to set
	 * `ResolvedEntity.viaPack` and to format collision messages. Oxygen Phase 2.
	 */
	packMemberViaPack: Map<string, string>;
	/**
	 * Names of packs that were referenced (and expanded) during resolution.
	 * Used by the unreferenced-pack warning. Oxygen Phase 2.
	 */
	packsReferencedByName: Set<string>;
}

interface OriginHiddenHint {
	repo: string;
	reason: "dev-dependency" | "publish-false";
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
		originHiddenHints: new Map(),
		packMemberOrigin: new Map(),
		packMemberViaPack: new Map(),
		packsReferencedByName: new Set(),
	};

	await resolveRepoVersions(state.expanded, state);
	await expandPackReferences(state);
	await resolveRepoVersions(state.expanded, state); // Phase 1.5b: idempotent second pass for repos introduced by pack members
	await checkStaleTagManifests(state);
	await processDeps(state.expanded.dependencies, "prod", state);
	await processDeps(state.expanded["dev-dependencies"], "dev", state);

	const installOrder = topologicalSort(state.entities, state.resolutionContext, state.errors);

	return {
		entities: state.entities,
		errors: state.errors,
		warnings: state.warnings,
		installOrder,
	};
}

function indentBlock(text: string, indent: string): string {
	return text
		.split("\n")
		.map((line) => (line.length > 0 ? indent + line : line))
		.join("\n");
}

async function resolveRepoVersions(expanded: Manifest, state: ResolutionState): Promise<void> {
	const repoConstraints = new Map<string, Constraint[]>();
	const consumerSource: ConstraintSource = {
		kind: "consumer",
		manifestPath: MANIFEST_NEW,
	};

	for (const deps of [expanded.dependencies, expanded["dev-dependencies"]]) {
		if (!deps) continue;
		for (const [key, dep] of Object.entries(deps)) {
			let repo: string | undefined;
			let version: string | undefined;
			if (isRemoteDependency(dep)) {
				repo = dep.repo;
				version = dep.version;
			} else if (isPackDependency(dep) && dep.repo) {
				// A remote pack reference needs its containing repo resolved up
				// front so Phase 1.5 can read the pack's manifest at the pinned ref.
				repo = dep.repo;
				version = dep.version;
			}
			if (!repo) continue;
			const existing = repoConstraints.get(repo) ?? [];
			existing.push({
				name: key,
				constraint: version ?? "*",
				source: consumerSource,
			});
			repoConstraints.set(repo, existing);
		}
	}

	for (const [repo, constraints] of repoConstraints) {
		await resolveOneRepo(repo, constraints, state);
	}
}

async function resolveOneRepo(
	repo: string,
	constraints: Constraint[],
	state: ResolutionState,
): Promise<void> {
	// Idempotent: Phase 1.5b calls resolveRepoVersions a second time to pick
	// up repos introduced by pack-member injection. Skip anything Phase 1 already
	// resolved so the second pass is free for unchanged repos.
	if (state.repoResolutions.has(repo)) return;
	try {
		const cachePath = await ensureCached(repo);
		const tags = await listTags(cachePath);

		const result = resolveIntersection(tags, constraints);
		if ("error" in result) {
			if (result.error === "No semver tags found") {
				await addTaglessRepoResolution(repo, cachePath, state);
			} else {
				state.errors.push(
					`Error: Version conflict on repo ${repo}\n\n${indentBlock(result.error, "  ")}\n\nFix: Align version constraints in the listed manifest(s), or move entities to separate repos.`,
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
				`Error: Git operation failed\n\n  Failed to fetch ${repo}\n  Underlying error: ${errMsg}\n\nFix: Check the repo URL in ${MANIFEST_NEW} and your git access (SSH keys, GITHUB_TOKEN).`,
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

// =============================================================================
// Pack expansion (Phase 1.5) — Oxygen Phase 2
// =============================================================================

/**
 * Expand every `PackDependency` in `state.expanded.dependencies` / `["dev-dependencies"]`
 * into N synthesized direct-dep entries (one per pack member). After this runs,
 * the deps map contains only entity deps, and `processDeps` resolves them
 * normally with the right `declaredIn` attribution and `viaPack` provenance.
 *
 * Packs are not entities — no `state.entities` row, no lockfile entry, no
 * install work. See docs/specs/packs.md.
 */
async function expandPackReferences(state: ResolutionState): Promise<void> {
	for (const group of ["dependencies", "dev-dependencies"] as const) {
		const deps = state.expanded[group];
		if (!deps) continue;
		// Snapshot the entries so deletion during iteration is safe.
		for (const [key, dep] of Object.entries({ ...deps })) {
			if (!isPackDependency(dep)) continue;
			state.packsReferencedByName.add(dep.pack);
			const fetched = await fetchPackMembers(group, key, dep, state);
			delete deps[key];
			state.manifestKeys.delete(key);
			if (!fetched) continue;
			injectPackMembers(group, key, dep, fetched.members, fetched.origin, state);
		}
	}
	warnUnreferencedPacks(state);
}

interface FetchedMembers {
	members: PackMember[];
	origin: EntityOrigin;
}

async function fetchPackMembers(
	group: "dependencies" | "dev-dependencies",
	key: string,
	dep: PackDependency,
	state: ResolutionState,
): Promise<FetchedMembers | null> {
	// Local pack: no `repo`/`source` after expandSources. Look up in own manifest.
	if (!dep.repo) {
		const members = state.expanded.packs?.[dep.pack];
		if (!members || members.length === 0) {
			state.errors.push(
				`Error: Pack "${dep.pack}" is referenced under ${group}.${key} but not defined in this manifest's \`packs:\` section.\n\n  Fix: define it under \`packs:\`, or set \`repo:\` to point at a manifest that defines it.`,
			);
			return null;
		}
		return {
			members,
			origin: { kind: "consumer", manifestPath: MANIFEST_NEW },
		};
	}

	// Remote pack: read packs: from the containing repo's manifest at the resolved ref.
	const resolution = state.repoResolutions.get(dep.repo);
	if (!resolution) {
		// Phase 1 already failed to resolve this repo and pushed an error.
		return null;
	}
	const ref = resolution.tag ?? resolution.commit;

	let manifestContent: string;
	try {
		manifestContent = await readOriginManifestAtRef(resolution.cachePath, ref);
	} catch {
		state.errors.push(
			`Error: Pack "${dep.pack}" not found in ${dep.repo}@${shortRef(ref)} — no ${MANIFEST_NEW} at that ref.`,
		);
		return null;
	}

	let originManifest: Manifest;
	try {
		originManifest = parseManifest(manifestContent);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		state.errors.push(
			`Error: Pack "${dep.pack}": failed to parse ${MANIFEST_NEW} in ${dep.repo}@${shortRef(ref)}: ${msg}`,
		);
		return null;
	}

	const expandedOrigin = expandSources(originManifest);
	const members = expandedOrigin.packs?.[dep.pack];
	if (!members || members.length === 0) {
		state.errors.push(
			`Error: Pack "${dep.pack}" not found in ${dep.repo}@${shortRef(ref)} (expected under \`packs:\` in ${MANIFEST_NEW}).`,
		);
		return null;
	}

	return {
		members,
		origin: { kind: "transitive", originRepo: dep.repo, ref },
	};
}

function injectPackMembers(
	group: "dependencies" | "dev-dependencies",
	packKey: string,
	packRef: PackDependency,
	members: PackMember[],
	origin: EntityOrigin,
	state: ResolutionState,
): void {
	const deps = state.expanded[group];
	if (!deps) return;
	const isRemotePack = origin.kind === "transitive";

	for (const member of members) {
		// Remote pack with a `local:` member: the path lives on the pack
		// author's filesystem and is meaningless on the consumer side. Even a
		// relative path would resolve against `state.projectDir`, not the pack
		// host's repo — silently wrong. v1 rejects all `local:` members of
		// remote packs; if you need shared local skills, define them in a
		// local pack. (A future version could mirror `tryResolveFromOriginManifest`
		// and convert relative-local members to remote refs pointing at the
		// pack-host repo, but that doubles the spec surface — defer until asked.)
		if (isRemotePack && "local" in member) {
			const which = isRelativeLocalPath(member.local) ? "" : "absolute ";
			state.errors.push(
				`Error: Pack "${packRef.pack}" (via ${packKey}, ${formatOrigin(origin)}) contains a member with a ${which}local path ("${member.local}"). \`local:\` members are only valid in local packs.`,
			);
			continue;
		}

		const memberKey = deriveMemberKey(member);
		if (!memberKey) {
			state.errors.push(
				`Error: Pack "${packRef.pack}" member has no derivable name (need \`name:\`, \`path:\`, or \`local:\`).`,
			);
			continue;
		}

		const collidingDep = deps[memberKey];
		if (collidingDep) {
			const existing = describeCollidingDep(memberKey, collidingDep, state);
			state.errors.push(
				`Error: Member "${memberKey}" of pack "${packRef.pack}" (via ${packKey}, ${formatOrigin(origin)}) collides with ${existing}.\n\n  Fix: remove the duplicate, or rename one yaml key. To override a pack member, change the pack composition rather than redeclaring the member.`,
			);
			continue;
		}

		deps[memberKey] = member as Dependency;
		state.manifestKeys.add(memberKey);
		state.packMemberOrigin.set(memberKey, origin);
		state.packMemberViaPack.set(memberKey, packKey);
	}
}

function deriveMemberKey(m: PackMember): string {
	if ("name" in m && m.name) return m.name;
	if ("path" in m && m.path) return basename(m.path);
	if ("local" in m && m.local) return basename(m.local);
	return "";
}

function describeCollidingDep(key: string, dep: Dependency, state: ResolutionState): string {
	const viaPack = state.packMemberViaPack.get(key);
	if (viaPack) return `another pack member injected by pack "${viaPack}"`;
	if (isLocalDependency(dep)) return `consumer-declared dep "${key}" (local: ${dep.local})`;
	if (isRemoteDependency(dep)) return `consumer-declared dep "${key}" (from ${dep.repo})`;
	return `consumer-declared dep "${key}"`;
}

function warnUnreferencedPacks(state: ResolutionState): void {
	const packs = state.expanded.packs;
	if (!packs) return;
	for (const name of Object.keys(packs)) {
		if (!state.packsReferencedByName.has(name)) {
			state.warnings.push(
				`Warning: pack "${name}" defined in \`packs:\` is never referenced. Reference it via dependencies, or remove the definition.`,
			);
		}
	}
}

function shortRef(ref: string): string {
	return ref.length > 12 ? ref.slice(0, 7) : ref;
}

async function processDeps(
	deps: Record<string, Dependency> | undefined,
	defaultGroup: DependencyGroup,
	state: ResolutionState,
): Promise<void> {
	if (!deps) return;
	for (const [key, dep] of Object.entries(deps)) {
		const entityName = "name" in dep && dep.name ? (dep.name as string) : key;
		// Consumer-declared direct deps are the only ones that can trigger R10
		// path-warnings (synthesized deps inherit their path from origin and
		// would always look "redundant").
		const declaredIn =
			state.packMemberOrigin.get(key) ??
			({ kind: "consumer", manifestPath: MANIFEST_NEW } as EntityOrigin);
		const viaPack = state.packMemberViaPack.get(key);
		await resolveEntity(key, entityName, dep, defaultGroup, state, true, declaredIn, viaPack);
	}
}

async function resolveEntity(
	yamlKey: string,
	entityName: string,
	dep: Dependency,
	group: DependencyGroup,
	state: ResolutionState,
	fromConsumerManifest = false,
	declaredIn: EntityOrigin = { kind: "consumer", manifestPath: MANIFEST_NEW },
	viaPack?: string,
): Promise<void> {
	if (isLocalDependency(dep)) {
		await resolveLocalEntity(yamlKey, entityName, dep, group, state, declaredIn, viaPack);
	} else if (isRemoteDependency(dep)) {
		await resolveRemoteEntity(
			yamlKey,
			entityName,
			dep,
			group,
			state,
			fromConsumerManifest,
			declaredIn,
			viaPack,
		);
	}
	// Pack refs never reach here — they're stripped from deps by Phase 1.5.
}

function formatOrigin(origin: EntityOrigin | undefined): string {
	if (!origin) return "<unknown manifest>";
	if (origin.kind === "consumer") return origin.manifestPath;
	const ref = origin.ref.length > 12 ? origin.ref.slice(0, 7) : origin.ref;
	return `${origin.originRepo}@${ref}`;
}

function originForTransitive(parentEntity: ResolvedEntity | undefined): EntityOrigin {
	if (!parentEntity?.repo) {
		// Parent is local → the transitive dep is still declared in a local
		// SKILL.md, which lives alongside the project. Attribute to consumer.
		return { kind: "consumer", manifestPath: MANIFEST_NEW };
	}
	const ref = parentEntity.tag ?? parentEntity.commit;
	return { kind: "transitive", originRepo: parentEntity.repo, ref };
}

function checkDuplicate(
	compositeKey: string,
	yamlKey: string,
	group: DependencyGroup,
	state: ResolutionState,
	declaredIn: EntityOrigin,
): boolean {
	if (!state.entities.has(compositeKey)) return false;

	const existing = state.entities.get(compositeKey);
	if (existing) {
		if (
			existing.key !== yamlKey &&
			state.manifestKeys.has(existing.key) &&
			state.manifestKeys.has(yamlKey)
		) {
			const existingOrigin = formatOrigin(existing.declaredIn);
			const newOrigin = formatOrigin(declaredIn);
			state.errors.push(
				`Error: Duplicate entity resolution on ${compositeKey}\n\n  "${existing.key}" declared in ${existingOrigin}\n  "${yamlKey}" declared in ${newOrigin}\n\nFix: Use distinct names (rename one yaml key), or remove one entry.`,
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
		const fmPath = isSingleFileEntity(type) ? localPath : `${localPath}/SKILL.md`;
		const content = await readFile(fmPath, "utf-8");
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
		const fmFile = isSingleFileEntity(type) ? entityPath : `${entityPath}/SKILL.md`;
		const content = await readFileAtRef(cachePath, ref, stripDotSlash(fmFile));
		const fm = parseFrontmatter(content);
		return (fm ? getDeclaredDeps(fm) : []).filter((d) => d !== entityName);
	} catch {
		return [];
	}
}

async function resolveLocalEntity(
	yamlKey: string,
	entityName: string,
	dep: {
		local: string;
		type?: EntityType;
		name?: string;
		_sourceDir?: string;
		publish?: boolean;
		exclude?: string[];
	},
	group: DependencyGroup,
	state: ResolutionState,
	declaredIn: EntityOrigin = { kind: "consumer", manifestPath: MANIFEST_NEW },
	viaPack?: string,
): Promise<void> {
	const expandedLocal = expandTilde(dep.local);
	const localPath = expandedLocal.startsWith("/")
		? expandedLocal
		: `${state.projectDir}/${expandedLocal}`;
	const type = dep.type ?? (await inferType(localPath));
	const compositeKey = `${type}:${entityName}`;

	if (checkDuplicate(compositeKey, yamlKey, group, state, declaredIn)) return;

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
		declaredIn,
		sourceDir: dep._sourceDir ? expandTilde(dep._sourceDir) : undefined,
	};
	if (dep.publish !== undefined) entity.publish = dep.publish;
	if (dep.exclude !== undefined) entity.exclude = dep.exclude;
	if (viaPack) entity.viaPack = viaPack;

	registerEntity(entity, state);

	for (const transDepName of frontmatterDeps) {
		await resolveTransitive(transDepName, group, compositeKey, state);
	}
}

async function resolveRemoteEntity(
	yamlKey: string,
	entityName: string,
	dep: {
		repo: string;
		path?: string;
		version?: string;
		type?: EntityType;
		name?: string;
		force_path?: boolean;
	},
	group: DependencyGroup,
	state: ResolutionState,
	fromConsumerManifest = false,
	declaredIn: EntityOrigin = { kind: "consumer", manifestPath: MANIFEST_NEW },
	viaPack?: string,
): Promise<void> {
	const resolution = state.repoResolutions.get(dep.repo);
	if (!resolution) return;

	const ref = resolution.tag ?? resolution.commit;
	let entityPath = dep.path;

	if (entityPath === "") {
		// Reject an explicit empty-string path loudly rather than silently
		// inferring — that would mask a malformed manifest where the user
		// intended a real path.
		state.errors.push(
			`Error: "${entityName}" (from ${dep.repo}) has an empty \`path:\`. Remove it to trigger origin-manifest inference, or set it to a real path.`,
		);
		return;
	}

	if (!entityPath) {
		const inferred = await inferDirectDepPath(entityName, dep.repo, resolution, state);
		if (!inferred) {
			state.errors.push(
				`Error: "${entityName}" (from ${dep.repo}) has no path, and the resolver could not infer one from:\n       - origin's ${MANIFEST_NEW} dependencies (${dep.repo})\n       - conventional paths in ${dep.repo}\n\n     Fix: add \`path:\` to your ${MANIFEST_NEW} entry, or have origin declare "${entityName}" under \`dependencies:\` in its ${MANIFEST_NEW}.`,
			);
			return;
		}
		entityPath = inferred;
	} else if (fromConsumerManifest && dep.force_path !== true) {
		// R10: consumer-declared explicit path — check against origin's declaration.
		// Synthesized deps (from transitive resolution tiers) inherit their path
		// from origin and would always look "redundant"; skip them.
		// Strict `=== true` for consistency with add.ts preservation logic —
		// non-boolean truthy values (e.g., the string "false") don't silence
		// warnings, which forces user to fix malformed YAML.
		const mismatch = await detectPathMismatch(entityName, entityPath, dep.repo, resolution);
		if (mismatch) {
			state.warnings.push(formatPathWarning(mismatch, entityName, entityPath, dep.repo));
		}
	}

	let type = dep.type;
	if (!type) {
		const inferred = await inferTypeFromGit(resolution.cachePath, ref, entityPath);
		type = inferred.type;
		entityPath = inferred.resolvedPath;
	}
	// Validate that the path actually exists at the resolved ref
	const normalizedPath = stripDotSlash(entityPath);
	const exists = await pathExistsAtRef(resolution.cachePath, ref, normalizedPath);
	if (!exists) {
		const refLabel = resolution.tag ?? resolution.commit.slice(0, 8);
		state.errors.push(
			`"${entityName}" not found at path "${entityPath}" in repo "${dep.repo}" at ${refLabel} (declared in ${formatOrigin(declaredIn)}). It may have been moved or removed.`,
		);
		return;
	}

	const compositeKey = `${type}:${entityName}`;

	if (checkDuplicate(compositeKey, yamlKey, group, state, declaredIn)) return;

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
		declaredIn,
		cachePath: resolution.cachePath,
	};
	if (viaPack) entity.viaPack = viaPack;

	registerEntity(entity, state);

	for (const transDepName of frontmatterDeps) {
		await resolveTransitive(transDepName, group, compositeKey, state);
	}
}

async function resolveTransitive(
	depName: string,
	parentGroup: DependencyGroup,
	parentCompositeKey: string,
	state: ResolutionState,
): Promise<void> {
	if (useExistingResolution(depName, parentGroup, state)) return;
	if (await tryResolveFromManifest(depName, parentGroup, state)) return;
	if (await tryResolveFromLocalSource(depName, parentGroup, parentCompositeKey, state)) return;
	if (await tryResolveFromOriginManifest(depName, parentGroup, parentCompositeKey, state)) return;
	if (await tryResolveFromSameRepo(depName, parentGroup, parentCompositeKey, state)) return;
	addUnresolvedError(depName, parentCompositeKey, state);
}

/**
 * If `depName` is already resolved, promote it from `dev` to `prod` when the
 * current parent reaches it through `prod`, and signal "skip further
 * resolution" via `true`. Decision #11 (group assignment) — a transitive dep
 * reachable from both groups is `prod`.
 */
function useExistingResolution(
	depName: string,
	parentGroup: DependencyGroup,
	state: ResolutionState,
): boolean {
	if (!state.resolutionContext.has(depName)) return false;
	const existingKey = state.resolutionContext.get(depName);
	const existing = existingKey ? state.entities.get(existingKey) : undefined;
	if (existing && parentGroup === "prod" && existing.group === "dev") {
		existing.group = "prod";
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
	// Declared in the consumer manifest even though the resolution path reached
	// here transitively — the yaml key lives in `state.expanded`.
	await resolveEntity(depName, actualName, dep, parentGroup, state, false, {
		kind: "consumer",
		manifestPath: MANIFEST_NEW,
	});
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

/**
 * Read an origin manifest at a git ref, accepting either skilltree.yml or
 * skilltree.yaml. Throws if neither exists. Prefers .yml (the canonical
 * extension) when both are present at the ref (the local resolver is the
 * right place to flag the dual-extension mistake — upstreams can't see
 * this code path).
 */
async function readOriginManifestAtRef(cachePath: string, ref: string): Promise<string> {
	try {
		return await readFileAtRef(cachePath, ref, MANIFEST_NEW);
	} catch {
		return await readFileAtRef(cachePath, ref, MANIFEST_NEW_ALT);
	}
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
		manifestContent = await readOriginManifestAtRef(resolution.cachePath, ref);
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
			state.originHiddenHints.set(depName, {
				repo: parentEntity.repo,
				reason: "dev-dependency",
			});
		}
		return false;
	}

	// Origin declared the entry in `dependencies` but marked it not for sharing.
	// Treat the same as the dev-dependency case: record a hint and fall through
	// so downstream gets an actionable error. (publication_surface.md §PS15.)
	if (isLocalDependency(prodEntry) && prodEntry.publish === false) {
		state.originHiddenHints.set(depName, {
			repo: parentEntity.repo,
			reason: "publish-false",
		});
		return false;
	}

	const transitiveOrigin = originForTransitive(parentEntity);

	if (isLocalDependency(prodEntry)) {
		// Absolute `local:` paths come from `source:` aliases pointing at
		// origin's author's filesystem. Consumers have no such path.
		if (!isRelativeLocalPath(prodEntry.local)) return false;

		const localPath = stripDotSlash(prodEntry.local);
		const syntheticDep = {
			repo: parentEntity.repo,
			path: localPath,
			...(prodEntry.type ? { type: prodEntry.type } : {}),
			...(prodEntry.name ? { name: prodEntry.name } : {}),
		};

		const actualName = prodEntry.name ?? depName;
		await resolveEntity(
			depName,
			actualName,
			syntheticDep,
			parentGroup,
			state,
			false,
			transitiveOrigin,
		);
		return true;
	}

	if (isRemoteDependency(prodEntry)) {
		const ok = await ensureRepoResolvedLazy(
			prodEntry.repo,
			prodEntry.version ?? "*",
			parentEntity.repo,
			state,
		);
		if (!ok) {
			// Error already added by the helper; returning true short-circuits
			// the remaining tiers so we don't emit a second, redundant error.
			return true;
		}

		const actualName = prodEntry.name ?? depName;
		await resolveEntity(
			depName,
			actualName,
			prodEntry,
			parentGroup,
			state,
			false,
			transitiveOrigin,
		);
		return true;
	}

	return false;
}

function isRelativeLocalPath(path: string): boolean {
	return !path.startsWith("/") && !path.startsWith("~");
}

function hasDotDotSegment(path: string): boolean {
	return path.split("/").includes("..");
}

/**
 * Check whether an explicit consumer path matches/conflicts with origin's
 * declared path for the same name. Returns the mismatch kind and origin's
 * path, or null if no comparable declaration exists. R10.
 */
async function detectPathMismatch(
	entityName: string,
	consumerPath: string,
	consumerRepo: string,
	resolution: RepoResolution,
): Promise<{ kind: "redundant" | "override"; originPath: string } | null> {
	const ref = resolution.tag ?? resolution.commit;

	let manifestContent: string;
	try {
		manifestContent = await readOriginManifestAtRef(resolution.cachePath, ref);
	} catch {
		return null;
	}

	let originManifest: Manifest;
	try {
		originManifest = parseManifest(manifestContent);
	} catch {
		return null;
	}

	const expanded = expandSources(originManifest);
	const entry = expanded.dependencies?.[entityName];
	if (!entry) return null;

	let originPath: string | null = null;
	if (isLocalDependency(entry) && isRelativeLocalPath(entry.local)) {
		const p = stripDotSlash(entry.local);
		if (!hasDotDotSegment(p)) originPath = p;
	} else if (
		isRemoteDependency(entry) &&
		entry.repo === consumerRepo &&
		entry.path &&
		!hasDotDotSegment(entry.path)
	) {
		originPath = entry.path;
	}

	if (!originPath) return null;

	return canonicalPath(consumerPath) === canonicalPath(originPath)
		? { kind: "redundant", originPath }
		: { kind: "override", originPath };
}

function formatPathWarning(
	mismatch: { kind: "redundant" | "override"; originPath: string },
	entityName: string,
	consumerPath: string,
	originRepo: string,
): string {
	if (mismatch.kind === "redundant") {
		return [
			`Warning: \`${entityName}\` declares path "${consumerPath}", which is the`,
			`  same path origin's ${MANIFEST_NEW} declares for this name (${originRepo}).`,
			`  You can omit \`path:\` — it will be inferred.`,
		].join("\n");
	}
	return [
		`Warning: \`${entityName}\` declares path "${consumerPath}", but origin's`,
		`  ${MANIFEST_NEW} declares this name at "${mismatch.originPath}" (${originRepo}).`,
		`  If this override is intentional, set \`force_path: true\` to silence this warning.`,
	].join("\n");
}

/**
 * For every resolved remote repo, check whether origin's `skilltree.yml` is
 * present at the resolved tag. If absent at the tag but present on the
 * default branch, emit a single warning — origin authored a manifest but
 * never cut a tag that contains it, so consumers lose R9/R10 signals they
 * would otherwise get.
 */
async function checkStaleTagManifests(state: ResolutionState): Promise<void> {
	for (const [repo, resolution] of state.repoResolutions) {
		const ref = resolution.tag ?? resolution.commit;

		// If manifest is present at the resolved ref, nothing to check.
		try {
			await readOriginManifestAtRef(resolution.cachePath, ref);
			continue;
		} catch {
			// Fall through — missing at tag.
		}

		let defaultBranch: string;
		try {
			defaultBranch = await getDefaultBranch(resolution.cachePath);
		} catch {
			continue;
		}

		try {
			await readOriginManifestAtRef(resolution.cachePath, defaultBranch);
		} catch {
			// Not on default branch either — origin simply doesn't use skilltree.yml.
			continue;
		}

		const tagLabel = resolution.tag ?? `commit ${resolution.commit.slice(0, 8)}`;
		state.warnings.push(
			[
				`Warning: origin \`${repo}\` has a ${MANIFEST_NEW} on \`${defaultBranch}\` but not at the`,
				`  resolved tag (${tagLabel}). Consumers resolve to the tag, so origin's manifest`,
				`  is invisible to them — R9 path inference and R10 path warnings are skipped.`,
				`  Fix: cut a new tag from \`${defaultBranch}\` that includes ${MANIFEST_NEW}.`,
			].join("\n"),
		);
	}
}

/**
 * Infer a direct dep's missing `path:` by consulting origin's skilltree.yml,
 * then falling back to conventional paths. Returns the inferred entity path
 * (suitable for inferTypeFromGit), or null if nothing works. See R9.
 */
async function inferDirectDepPath(
	entityName: string,
	consumerRepo: string,
	resolution: RepoResolution,
	_state: ResolutionState,
): Promise<string | null> {
	const ref = resolution.tag ?? resolution.commit;

	// Tier 1: origin manifest lookup.
	try {
		const manifestContent = await readOriginManifestAtRef(resolution.cachePath, ref);
		const originManifest = parseManifest(manifestContent);
		const expanded = expandSources(originManifest);
		const entry = expanded.dependencies?.[entityName];

		if (entry) {
			if (isLocalDependency(entry) && isRelativeLocalPath(entry.local)) {
				const p = stripDotSlash(entry.local);
				if (!hasDotDotSegment(p)) return p;
			} else if (
				isRemoteDependency(entry) &&
				entry.repo === consumerRepo &&
				entry.path &&
				!hasDotDotSegment(entry.path)
			) {
				return entry.path;
			}
			// absolute-local / different-repo / has-.. → fall through to probe
		}
	} catch {
		// missing or malformed origin manifest → fall through
	}

	// Tier 2: conventional probe.
	for (const candidate of conventionalCandidates(entityName)) {
		try {
			const probeFile = candidate.endsWith(".md") ? candidate : `${candidate}/SKILL.md`;
			await readFileAtRef(resolution.cachePath, ref, probeFile);
			return candidate;
		} catch {
			// try next
		}
	}

	return null;
}

async function ensureRepoResolvedLazy(
	repo: string,
	constraint: string,
	originRepo: string,
	state: ResolutionState,
): Promise<boolean> {
	const existing = state.repoResolutions.get(repo);
	if (existing) {
		if (constraint === "*") return true;
		// Tagless resolution — can't validate a constraint against no version.
		// Accept per today's behavior (tagless repos already warn during resolveOneRepo).
		if (!existing.version) return true;
		if (semver.satisfies(existing.version, constraint)) return true;
		state.errors.push(
			`Error: Cross-repo transitive constraint conflict\n\n  Origin ${originRepo} declares ${repo} with constraint "${constraint}",\n  but ${repo} is already resolved to ${existing.version}${existing.tag ? ` (tag ${existing.tag})` : ""} from another chain.\n\nFix: Align constraints by declaring ${repo} explicitly in your ${MANIFEST_NEW}.`,
		);
		return false;
	}

	// Transitive resolution path: synthesize an attributed Constraint so that
	// any conflict error in resolveIntersection names the upstream skilltree.yml
	// that asked for this repo, not a "<transitive via ...>" placeholder. The
	// originRepo's resolution may not exist yet (first transitive into a new
	// repo); fall back to "transitive" without a ref in that case.
	const originResolution = state.repoResolutions.get(originRepo);
	const ref = originResolution?.tag ?? originResolution?.commit ?? "transitive";
	await resolveOneRepo(
		repo,
		[
			{
				name: repo,
				constraint,
				source: { kind: "transitive", originRepo, ref },
			},
		],
		state,
	);
	return state.repoResolutions.has(repo);
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
	const transitiveOrigin = originForTransitive(parentEntity);

	for (const candidatePath of conventionalCandidates(depName)) {
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
			await resolveEntity(
				depName,
				depName,
				syntheticDep,
				parentGroup,
				state,
				false,
				transitiveOrigin,
			);
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
	const hint = state.originHiddenHints.get(depName);

	const lines = [
		`${parentName} (${parentSource}) declares dependency "${depName}",`,
		`     not found in:`,
		`       - your ${MANIFEST_NEW}`,
		`       - already-resolved dependencies`,
	];

	if (parentEntity?.repo) {
		lines.push(`       - origin's ${MANIFEST_NEW} dependencies (${parentEntity.repo})`);
		lines.push(`       - conventional paths in ${parentEntity.repo}`);
	} else {
		lines.push(`       - local filesystem`);
	}

	if (hint?.reason === "dev-dependency") {
		lines.push("");
		lines.push(
			`     Note: "${depName}" is declared as a dev-dependency in origin's manifest (${hint.repo}).`,
		);
		lines.push(`     dev-dependencies are not exposed to downstream consumers.`);
		lines.push(
			`     Fix: upstream should move it to \`dependencies\`, or declare ${depName} explicitly in your own ${MANIFEST_NEW}.`,
		);
	} else if (hint?.reason === "publish-false") {
		lines.push("");
		lines.push(
			`     Note: "${depName}" is declared in origin's manifest (${hint.repo}) but marked \`publish: false\`.`,
		);
		lines.push(`     publish: false entries are not exposed to downstream consumers.`);
		lines.push(
			`     Fix: upstream should remove \`publish: false\` once it's ready to share, or declare ${depName} explicitly in your own ${MANIFEST_NEW}.`,
		);
	} else {
		lines.push("");
		lines.push(`     Fix: skilltree add ${depName} --repo <repo-url> --path <path>`);
	}

	state.errors.push(lines.join("\n"));
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
		{ path: `${sourceDir}/commands/${depName}.md`, type: "command" },
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
			if ((candidate.type === "agent" || candidate.type === "command") && stats.isFile()) {
				const syntheticDep: LocalDependency = {
					local: candidate.path,
					type: candidate.type,
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
		if (stats.isFile() && localPath.endsWith(".md")) return mdFileType(localPath);
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
			return { type: mdFileType(normalizedPath), resolvedPath: normalizedPath };
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
	const type: EntityType = path.endsWith(".md") ? mdFileType(path) : "skill";
	return { type, resolvedPath: path };
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
