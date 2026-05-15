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
		const existing = await readFile(indexPath, "utf-8");
		if (existing.trim() === yamlContent.trim()) {
			console.log(`${INDEX_NEW} is up to date`);
		} else {
			console.log(
				`${INDEX_NEW} is stale (${entries.length} entities found). Run 'skilltree registry index' to update.`,
			);
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
