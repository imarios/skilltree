import { existsSync } from "node:fs";
import { readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import YAML from "yaml";
import { mdFileType } from "../core/entity-type.js";
import { INDEX_LEGACY, INDEX_NEW, resolveIndexPath } from "../core/filenames.js";
import { parseFrontmatter } from "../core/frontmatter.js";
import { readManifest } from "../core/manifest.js";
import { hiddenPathsFromManifest, SKIP_MD_FILES } from "../core/registry-scanner.js";
import type { IndexEntry } from "../types.js";

export async function indexCommand(opts: { check?: boolean }, dir?: string): Promise<void> {
	const baseDir = dir ?? process.cwd();
	const hiddenPaths = await loadHiddenPaths(baseDir);
	const entries = await scanLocalDirectory(baseDir, hiddenPaths);

	const yamlContent = YAML.stringify({ entities: entries }, { lineWidth: 0 });

	if (opts.check) {
		// resolveIndexPath emits the legacy deprecation warning when only
		// skillkit-index.yaml exists, and throws if both names are present.
		const { path: indexPath, filename } = resolveIndexPath(baseDir);
		if (filename === null) {
			console.log(`${INDEX_NEW} does not exist. Run 'skilltree registry index' to create it.`);
			process.exit(1);
		}
		// On the legacy path we exit 1 regardless of content equality — the
		// file name itself is "stale" and the maintainer is expected to
		// regenerate it so the canonical name takes over.
		if (filename === INDEX_LEGACY) {
			console.log(
				`${INDEX_LEGACY} is the deprecated name. Run 'skilltree registry index' to regenerate as ${INDEX_NEW}.`,
			);
			process.exit(1);
		}
		// Issue #62: --check used to compare scanner output against the file
		// as raw YAML text. That treated hand-authored entries for skills at
		// non-standard paths (scanner-unreachable depths, nested under a
		// parent SKILL.md, etc.) as "stale" — which made the index file
		// unusable for the very purpose docs/specs/registries.md advertises:
		// "a hand-curated public catalog... useful for non-standard layouts."
		//
		// New semantics: validate the index file is *consistent with reality*,
		// not byte-identical to a scanner dump.
		//   1. Every scanner-discoverable entity must be present in the index
		//      with the same name/type/description.
		//   2. Every "extra" entry in the index (a path the scanner did not
		//      visit) must point to a real on-disk entity. Phantom entries
		//      still fail --check; hand-authored entries for real
		//      non-standard skills/agents do not.
		// `tags` are scanner-invisible by design and are always preserved.
		const existing = await readFile(indexPath, "utf-8");
		const staleReasons = await diagnoseIndex(baseDir, existing, entries);
		if (staleReasons.length === 0) {
			console.log(`${INDEX_NEW} is up to date`);
		} else {
			console.log(
				`${INDEX_NEW} is stale (${entries.length} entities found). Run 'skilltree registry index' to update.`,
			);
			for (const reason of staleReasons) {
				console.log(`  - ${reason}`);
			}
			process.exit(1);
		}
		return;
	}

	await writeFile(join(baseDir, INDEX_NEW), yamlContent, "utf-8");
	// If the maintainer has a leftover legacy file, remove it on write so the
	// next `scanRegistry` and `--check` see a single canonical source. Makes
	// `skilltree registry index` the one-command migration path promised by
	// the deprecation warning.
	const legacyPath = join(baseDir, INDEX_LEGACY);
	let migratedLegacy = false;
	if (existsSync(legacyPath)) {
		await unlink(legacyPath);
		migratedLegacy = true;
	}
	const skills = entries.filter((e) => e.type === "skill").length;
	const agents = entries.filter((e) => e.type === "agent").length;
	const commands = entries.filter((e) => e.type === "command").length;
	console.log(
		`Scanned ${entries.length} entities (${skills} skills, ${agents} agents, ${commands} commands)`,
	);
	console.log(`Wrote ${INDEX_NEW}`);
	if (migratedLegacy) {
		console.log(`Removed legacy ${INDEX_LEGACY}`);
	}
}

/**
 * Build the set of entity paths the maintainer's manifest marks as not
 * publicly visible — `publish: false` locals plus dev-dependency locals.
 * Spec: publication_surface.md §PS14.
 *
 * Returned paths are normalized so a `relative(baseDir, fullPath)` walk
 * result can match them by equality. Delegates to the shared helper in
 * `registry-scanner` so the rule stays in one place.
 */
async function loadHiddenPaths(baseDir: string): Promise<Set<string>> {
	try {
		const manifest = await readManifest(baseDir);
		return hiddenPathsFromManifest(manifest);
	} catch {
		return new Set<string>(); // No manifest is fine — nothing to hide.
	}
}

async function scanLocalDirectory(
	baseDir: string,
	hiddenPaths: Set<string>,
): Promise<IndexEntry[]> {
	const entries: IndexEntry[] = [];
	await walkDir(baseDir, baseDir, entries, hiddenPaths);
	entries.sort((a, b) => a.name.localeCompare(b.name));
	return entries;
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build"]);

async function walkDir(
	currentDir: string,
	baseDir: string,
	entries: IndexEntry[],
	hiddenPaths: Set<string>,
): Promise<void> {
	const items = await readdir(currentDir);

	for (const item of items) {
		if (item.startsWith(".") || SKIP_DIRS.has(item)) continue;

		const fullPath = join(currentDir, item);
		const s = await stat(fullPath);

		if (s.isDirectory()) {
			if (await tryAddSkill(fullPath, baseDir, entries, hiddenPaths)) continue;
			await walkDir(fullPath, baseDir, entries, hiddenPaths);
		} else if (s.isFile() && item.endsWith(".md") && item !== "SKILL.md") {
			await tryAddAgent(fullPath, item, baseDir, entries, hiddenPaths);
		}
	}
}

async function tryAddSkill(
	fullPath: string,
	baseDir: string,
	entries: IndexEntry[],
	hiddenPaths: Set<string>,
): Promise<boolean> {
	const skillMdPath = join(fullPath, "SKILL.md");
	if (!existsSync(skillMdPath)) return false;

	const relPath = relative(baseDir, fullPath);
	if (hiddenPaths.has(relPath)) return true; // Skip but don't recurse into a hidden skill.

	try {
		const content = await readFile(skillMdPath, "utf-8");
		const fm = parseFrontmatter(content);
		const name = fm?.name ?? basename(fullPath);
		const entry: IndexEntry = { name, type: "skill", path: relPath };
		if (fm?.description) entry.description = fm.description;
		entries.push(entry);
	} catch {
		// Skip unreadable
	}
	return true; // Don't recurse into skill directories
}

/**
 * Compute the list of reasons (if any) that the existing index file is out
 * of sync with on-disk reality. Empty array = index is fine.
 *
 * Two failure modes (issue #62):
 *   1. Scanner discovers an entity the index is missing or has wrong data for.
 *   2. Index contains an entry whose path doesn't resolve to a real entity.
 *
 * Hand-authored entries at scanner-unreachable paths are valid and do not
 * trigger either failure mode, as long as a SKILL.md (skill) or markdown
 * file with frontmatter (agent/command) exists at the declared path.
 */
async function diagnoseIndex(
	baseDir: string,
	existingYaml: string,
	scannerEntries: IndexEntry[],
): Promise<string[]> {
	const reasons: string[] = [];

	let parsed: unknown;
	try {
		parsed = YAML.parse(existingYaml);
	} catch (err) {
		reasons.push(`existing index is not valid YAML: ${(err as Error).message}`);
		return reasons;
	}
	const fileEntries = extractEntities(parsed);
	if (fileEntries === null) {
		reasons.push("existing index is missing an `entities` list");
		return reasons;
	}

	const fileByPath = new Map<string, IndexEntry>();
	for (const e of fileEntries) {
		fileByPath.set(e.path, e);
	}

	// 1. Scanner-discoverable entities must each be represented in the file.
	for (const scanned of scannerEntries) {
		const found = fileByPath.get(scanned.path);
		if (!found) {
			reasons.push(`missing entry for ${scanned.path}`);
			continue;
		}
		const mismatch = compareScannerFields(scanned, found);
		if (mismatch) {
			reasons.push(`entry for ${scanned.path}: ${mismatch}`);
		}
	}

	// 2. Extras (entries the scanner didn't produce) must point to real
	//    entities on disk. This catches typos and stale paths without
	//    rejecting legitimate hand-authored entries.
	const scannerPaths = new Set(scannerEntries.map((e) => e.path));
	for (const fileEntry of fileEntries) {
		if (scannerPaths.has(fileEntry.path)) continue;
		const validity = await validateExtraEntry(baseDir, fileEntry);
		if (validity !== null) {
			reasons.push(`entry for ${fileEntry.path}: ${validity}`);
		}
	}

	return reasons;
}

/** Defensive `entities:` extraction from arbitrary YAML input. */
function extractEntities(parsed: unknown): IndexEntry[] | null {
	if (parsed === null || typeof parsed !== "object") return null;
	const entities = (parsed as { entities?: unknown }).entities;
	if (!Array.isArray(entities)) return null;
	const out: IndexEntry[] = [];
	for (const raw of entities) {
		if (raw === null || typeof raw !== "object") continue;
		const e = raw as Record<string, unknown>;
		if (typeof e.name !== "string" || typeof e.path !== "string") continue;
		if (e.type !== "skill" && e.type !== "agent" && e.type !== "command") continue;
		const entry: IndexEntry = { name: e.name, type: e.type, path: e.path };
		if (typeof e.description === "string") entry.description = e.description;
		if (Array.isArray(e.tags)) {
			entry.tags = e.tags.filter((t): t is string => typeof t === "string");
		}
		out.push(entry);
	}
	return out;
}

/**
 * Return a human-readable mismatch reason, or null if `file` matches what the
 * scanner produced. `tags` are intentionally ignored — the scanner never
 * emits tags, so hand-curated tags on otherwise-matching entries are kept.
 */
function compareScannerFields(scanner: IndexEntry, file: IndexEntry): string | null {
	if (file.name !== scanner.name) {
		return `name mismatch (have "${file.name}", expected "${scanner.name}")`;
	}
	if (file.type !== scanner.type) {
		return `type mismatch (have "${file.type}", expected "${scanner.type}")`;
	}
	if ((file.description ?? "") !== (scanner.description ?? "")) {
		return "description is out of date";
	}
	return null;
}

/**
 * Verify that an index entry whose path the scanner did not visit still
 * corresponds to a real entity on disk. Returns null when valid, or a
 * one-line reason otherwise.
 */
async function validateExtraEntry(baseDir: string, entry: IndexEntry): Promise<string | null> {
	const fullPath = join(baseDir, entry.path);
	if (entry.type === "skill") {
		return existsSync(join(fullPath, "SKILL.md")) ? null : "path does not contain a SKILL.md";
	}
	if (!existsSync(fullPath)) return "path does not exist";
	try {
		const content = await readFile(fullPath, "utf-8");
		const fm = parseFrontmatter(content);
		if (!fm || (!fm.name && !fm.skills)) {
			return "file has no usable frontmatter (`name` or `skills`)";
		}
		return null;
	} catch (err) {
		return `path is unreadable: ${(err as Error).message}`;
	}
}

async function tryAddAgent(
	fullPath: string,
	item: string,
	baseDir: string,
	entries: IndexEntry[],
	hiddenPaths: Set<string>,
): Promise<void> {
	if (SKIP_MD_FILES.has(item)) return;
	// Skip ALL-CAPS filenames (e.g., CONTRIBUTING.md)
	const upperBase = basename(item);
	if (upperBase === upperBase.toUpperCase() && upperBase !== upperBase.toLowerCase()) return;

	const relPath = relative(baseDir, fullPath);
	if (hiddenPaths.has(relPath)) return;

	try {
		const content = await readFile(fullPath, "utf-8");
		const fm = parseFrontmatter(content);
		if (!fm || (!fm.name && !fm.skills)) return;
		const name = fm.name ?? basename(item, ".md");
		const entry: IndexEntry = { name, type: mdFileType(relPath), path: relPath };
		if (fm.description) entry.description = fm.description;
		entries.push(entry);
	} catch {
		// Skip unreadable
	}
}
