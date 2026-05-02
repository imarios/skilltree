import { basename, dirname } from "node:path";
import simpleGit from "simple-git";
import YAML from "yaml";
import type { EntityType, IndexEntry } from "../types.js";
import { entityNameFromPath, mdFileType } from "./entity-type.js";
import { parseFrontmatter } from "./frontmatter.js";
import { readFileAtRef } from "./git.js";

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
 * Tries skillkit-index.yaml first, falls back to dynamic scanning.
 *
 * IMPORTANT: if you change the output shape, classification rules, or which
 * files are recognized here (or in any helper this calls), bump
 * `SCANNER_VERSION` in `core/registry-cache.ts`. That fingerprint is what
 * tells consumers their on-disk caches are no longer trustworthy (issue #25).
 */
export async function scanRegistry(repoDir: string): Promise<IndexEntry[]> {
	// Try skillkit-index.yaml first (fast path)
	try {
		const content = await readFileAtRef(repoDir, "HEAD", "skillkit-index.yaml");
		return parseSkillkitIndex(content);
	} catch {
		// No index file — fall back to dynamic scan
	}

	return dynamicScanRepo(repoDir);
}

/**
 * Parse a skillkit-index.yaml file into IndexEntry[].
 */
export function parseSkillkitIndex(yamlContent: string): IndexEntry[] {
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
