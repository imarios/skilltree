import { basename, dirname } from "node:path";
import simpleGit from "simple-git";
import YAML from "yaml";
import type { EntityType, IndexEntry, LocalDependency, Manifest } from "../types.js";
import { isLocalDependency } from "../types.js";
import { entityNameFromPath, mdFileType } from "./entity-type.js";
import { INDEX_NEW, MANIFEST_NEW, MANIFEST_NEW_ALT } from "./filenames.js";
import { parseFrontmatter } from "./frontmatter.js";
import { pathExistsAtRef, readFileAtRef } from "./git.js";
import { parseManifest } from "./manifest.js";
import { isPubliclyVisible } from "./visibility.js";

/** Files that are never agents even if they are .md — shared with index-cmd.ts */
export const SKIP_MD_FILES = new Set([
	"README.md",
	"CHANGELOG.md",
	"LICENSE.md",
	"CONTRIBUTING.md",
	"CODE_OF_CONDUCT.md",
	"SECURITY.md",
	"BACKLOG.md",
	"CLAUDE.md",
	"PLAN.md",
	"TEST_PLAN.md",
	"SHORT_MEMORY.md",
	"DECISIONS.md",
	"PROJECTS.md",
]);

/**
 * Scan a bare git repo for skills and agents.
 * Tries the canonical index file first, then falls back to dynamic scanning.
 *
 * IMPORTANT: if you change the output shape, classification rules, or which
 * files are recognized here (or in any helper this calls), bump
 * `SCANNER_VERSION` in `core/registry-cache.ts`. That fingerprint is what
 * tells consumers their on-disk caches are no longer trustworthy (issue #25).
 */
export async function scanRegistry(repoDir: string): Promise<IndexEntry[]> {
	// Tier 1: curated index file. Maintainer's authoritative override.
	if (await pathExistsAtRef(repoDir, "HEAD", INDEX_NEW)) {
		const content = await readFileAtRef(repoDir, "HEAD", INDEX_NEW);
		return parseIndex(content);
	}

	// Read the manifest once — used by both tier 2 (as the source of entries)
	// and tier 3 (as the source of paths to hide). One git read either way.
	const manifest = await readManifestAtRef(repoDir);

	// Tier 2: skilltree.yml as inferred index — uses the maintainer's own
	// manifest declarations (publication_surface.md §PS12). Only fires when
	// the manifest has ≥1 publicly-visible local entry; otherwise falls
	// through to dynamic scan so repos that consume deps without authoring
	// any keep working as before.
	if (manifest) {
		const manifestEntries = await manifestEntriesFromManifest(repoDir, manifest);
		if (manifestEntries.length > 0) {
			return manifestEntries;
		}
	}

	// Tier 3: dynamic scan — walk SKILL.md/.md files via git ls-tree, then
	// strip any entries the manifest marks as hidden (publish: false locals
	// and dev-dependency locals). Spec PS13: "for paths not in the manifest,
	// treat as visible". When no manifest exists the hidden set is empty.
	const hidden = manifest ? hiddenPathsFromManifest(manifest) : new Set<string>();
	const dynamic = await dynamicScanRepo(repoDir);
	if (hidden.size === 0) return dynamic;
	return dynamic.filter((e) => !hidden.has(e.path));
}

/**
 * Tier 2 of the fallback chain (publication_surface.md §PS12–PS13).
 *
 * Reads the repo's skilltree.yml at HEAD and emits IndexEntries for each
 * publicly-visible local dep. Returns `null` when no manifest is present
 * or unparseable. Convenience wrapper around `manifestEntriesFromManifest`
 * for callers that just want "is there a manifest and what does it say."
 */
export async function manifestScanRepo(repoDir: string): Promise<IndexEntry[] | null> {
	const manifest = await readManifestAtRef(repoDir);
	if (!manifest) return null;
	return manifestEntriesFromManifest(repoDir, manifest);
}

/**
 * Same as `manifestScanRepo` but takes an already-parsed manifest. Lets
 * `scanRegistry` parse once and reuse the result for both tier-2 emission
 * and tier-3 hidden-path filtering.
 */
async function manifestEntriesFromManifest(
	repoDir: string,
	manifest: Manifest,
): Promise<IndexEntry[]> {
	const deps = manifest.dependencies;
	if (!deps) return [];

	const entries: IndexEntry[] = [];
	for (const [key, dep] of Object.entries(deps)) {
		if (!isLocalDependency(dep)) continue;
		if (!isPubliclyVisible(dep, "dependencies")) continue;

		const normalized = normalizeLocalPath(dep.local);
		if (!normalized) continue; // Absolute or ~ path — not part of this repo

		const entry = await buildManifestEntry(repoDir, key, dep, normalized);
		if (entry) entries.push(entry);
	}
	return entries;
}

/**
 * Collect normalized paths the manifest marks as not publicly visible:
 * `publish: false` locals and `dev-dependencies` locals. Used by tier 3
 * (dynamic scan) to strip these from emitted entries (spec PS13) and by
 * `skilltree registry index` to filter generated output (spec PS14).
 */
export function hiddenPathsFromManifest(manifest: Manifest): Set<string> {
	const hidden = new Set<string>();
	for (const group of ["dependencies", "dev-dependencies"] as const) {
		const deps = manifest[group];
		if (!deps) continue;
		for (const dep of Object.values(deps)) {
			if (!isLocalDependency(dep)) continue;
			if (isPubliclyVisible(dep, group)) continue;
			const normalized = normalizeLocalPath(dep.local);
			if (normalized !== null) hidden.add(normalized);
		}
	}
	return hidden;
}

async function readManifestAtRef(repoDir: string): Promise<Manifest | null> {
	for (const name of [MANIFEST_NEW, MANIFEST_NEW_ALT]) {
		if (!(await pathExistsAtRef(repoDir, "HEAD", name))) continue;
		try {
			const content = await readFileAtRef(repoDir, "HEAD", name);
			return parseManifest(content);
		} catch {
			// Malformed manifest — fall through. Same conservatism as tier 1.
			return null;
		}
	}
	return null;
}

/**
 * Strip a leading `./` from a manifest `local:` value. Returns `null` for
 * absolute paths and `~`-prefixed paths — those point outside this repo
 * (typically an author's local-source alias) and are not publishable from it.
 */
function normalizeLocalPath(local: string): string | null {
	if (local.startsWith("/") || local.startsWith("~")) return null;
	return local.replace(/^\.\//, "").replace(/\/+$/, "");
}

async function buildManifestEntry(
	repoDir: string,
	key: string,
	dep: LocalDependency,
	normalizedPath: string,
): Promise<IndexEntry | null> {
	const type = inferEntityType(dep, normalizedPath);
	const name = dep.name ?? key;

	const frontmatterPath = type === "skill" ? `${normalizedPath}/SKILL.md` : normalizedPath;
	let description: string | undefined;
	try {
		if (await pathExistsAtRef(repoDir, "HEAD", frontmatterPath)) {
			const content = await readFileAtRef(repoDir, "HEAD", frontmatterPath);
			const fm = parseFrontmatter(content);
			if (fm?.description) description = fm.description;
		}
	} catch {
		// Unreadable — emit the entry without a description rather than dropping it.
	}

	const entry: IndexEntry = { name, type, path: normalizedPath };
	if (description) entry.description = description;
	return entry;
}

function inferEntityType(
	dep: { type?: EntityType; local: string },
	normalizedPath: string,
): EntityType {
	if (dep.type) return dep.type;
	if (normalizedPath.endsWith(".md")) return mdFileType(normalizedPath);
	return "skill";
}

/**
 * Parse an index file (skilltree-index.yml) into IndexEntry[].
 */
export function parseIndex(yamlContent: string): IndexEntry[] {
	const raw = YAML.parse(yamlContent);
	if (!raw || typeof raw !== "object" || !Array.isArray(raw.entities)) {
		return [];
	}

	return raw.entities
		.filter(
			(e: unknown): e is Record<string, unknown> =>
				typeof e === "object" && e !== null && "name" in e && "type" in e && "path" in e,
		)
		.map((e: Record<string, unknown>) => {
			const entry: IndexEntry = {
				name: e.name as string,
				type: e.type as EntityType,
				path: e.path as string,
			};
			if (typeof e.description === "string") entry.description = e.description;
			if (Array.isArray(e.tags))
				entry.tags = e.tags.filter((t): t is string => typeof t === "string");
			return entry;
		});
}

/**
 * Dynamically scan a bare git repo for skills and agents
 * by walking the tree and reading frontmatter.
 */
export async function dynamicScanRepo(repoDir: string): Promise<IndexEntry[]> {
	const git = simpleGit(repoDir);

	// Get all paths in the repo
	const treeOutput = await git.raw(["ls-tree", "-r", "--name-only", "HEAD"]);
	const allPaths = treeOutput
		.trim()
		.split("\n")
		.filter((p) => p.length > 0);

	// Find SKILL.md files → skills (parallel reads)
	const skillPaths = allPaths.filter((p) => p.endsWith("/SKILL.md") || p === "SKILL.md");
	const skillEntries = await Promise.all(
		skillPaths.map(async (skillPath): Promise<IndexEntry | null> => {
			try {
				const content = await readFileAtRef(repoDir, "HEAD", skillPath);
				const fm = parseFrontmatter(content);
				const skillDir = skillPath === "SKILL.md" ? "." : dirname(skillPath);
				const name = fm?.name ?? basename(skillDir);
				const entry: IndexEntry = { name, type: "skill", path: skillDir };
				if (fm?.description) entry.description = fm.description;
				return entry;
			} catch {
				return null;
			}
		}),
	);

	// Skill directory prefixes — used to exclude internal `.md` files (e.g.,
	// `skills/foo/commands/helper.md`, `skills/foo/references/notes.md`)
	// from the agent/command scan. Mirrors the walk-stops-at-SKILL.md
	// guard in `repo-scanner.ts`. Without this, `mdFileType` would
	// mis-classify any helper file under a skill's `commands/` subdir as a
	// top-level slash-command. A repo-root SKILL.md (skillDir === ".")
	// owns the entire repo, so we treat it as a "" prefix that matches
	// every other path.
	const skillDirPrefixes = skillPaths.map((p) => (p === "SKILL.md" ? "" : `${dirname(p)}/`));
	const isInsideSkill = (p: string): boolean =>
		skillDirPrefixes.some((prefix) => prefix === "" || p.startsWith(prefix));

	// Find standalone .md files that could be agents (parallel reads)
	const mdPaths = allPaths.filter((p) => {
		if (!p.endsWith(".md")) return false;
		if (p.endsWith("/SKILL.md") || p === "SKILL.md") return false;
		if (isInsideSkill(p)) return false;
		if (SKIP_MD_FILES.has(basename(p))) return false;
		const base = basename(p);
		if (base === base.toUpperCase() && base !== base.toLowerCase()) return false;
		return true;
	});

	const agentEntries = await Promise.all(
		mdPaths.map(async (mdPath): Promise<IndexEntry | null> => {
			try {
				const content = await readFileAtRef(repoDir, "HEAD", mdPath);
				const fm = parseFrontmatter(content);
				if (!fm) return null;
				const type = mdFileType(mdPath);
				// Agents need a `name:` or `skills:` heuristic so loose `.md`
				// notes outside `commands/` don't get indexed. Slash-commands
				// (path under `commands/`) conventionally carry only
				// `description:`, so the path itself is signal enough — see
				// issue #21.
				if (type === "agent" && !fm.name && !fm.skills) return null;
				const name = fm.name ?? entityNameFromPath(mdPath);
				const entry: IndexEntry = { name, type, path: mdPath };
				if (fm.description) entry.description = fm.description;
				return entry;
			} catch {
				return null;
			}
		}),
	);

	// Deduplicate by name — first occurrence wins (source path takes priority over installed path)
	const all = [...skillEntries, ...agentEntries].filter((e): e is IndexEntry => e !== null);
	const seen = new Set<string>();
	return all.filter((e) => {
		const key = `${e.type}:${e.name}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
