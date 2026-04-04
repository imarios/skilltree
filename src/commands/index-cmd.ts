import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import YAML from "yaml";
import { parseFrontmatter } from "../core/frontmatter.js";
import { SKIP_MD_FILES } from "../core/registry-scanner.js";
import type { IndexEntry } from "../types.js";

export async function indexCommand(opts: { check?: boolean }, dir?: string): Promise<void> {
	const baseDir = dir ?? process.cwd();
	const entries = await scanLocalDirectory(baseDir);

	const yamlContent = YAML.stringify({ entities: entries }, { lineWidth: 0 });

	if (opts.check) {
		const indexPath = join(baseDir, "skillkit-index.yaml");
		if (!existsSync(indexPath)) {
			console.log("skillkit-index.yaml does not exist. Run 'skilltree index' to create it.");
			process.exit(1);
		}
		const existing = await readFile(indexPath, "utf-8");
		if (existing.trim() === yamlContent.trim()) {
			console.log("skillkit-index.yaml is up to date");
		} else {
			console.log(
				`skillkit-index.yaml is stale (${entries.length} entities found). Run 'skilltree index' to update.`,
			);
			process.exit(1);
		}
		return;
	}

	await writeFile(join(baseDir, "skillkit-index.yaml"), yamlContent, "utf-8");
	const skills = entries.filter((e) => e.type === "skill").length;
	const agents = entries.filter((e) => e.type === "agent").length;
	console.log(`Scanned ${entries.length} entities (${skills} skills, ${agents} agents)`);
	console.log("Wrote skillkit-index.yaml");
}

async function scanLocalDirectory(baseDir: string): Promise<IndexEntry[]> {
	const entries: IndexEntry[] = [];
	await walkDir(baseDir, baseDir, entries);
	entries.sort((a, b) => a.name.localeCompare(b.name));
	return entries;
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build"]);

async function walkDir(currentDir: string, baseDir: string, entries: IndexEntry[]): Promise<void> {
	const items = await readdir(currentDir);

	for (const item of items) {
		if (item.startsWith(".") || SKIP_DIRS.has(item)) continue;

		const fullPath = join(currentDir, item);
		const s = await stat(fullPath);

		if (s.isDirectory()) {
			if (await tryAddSkill(fullPath, baseDir, entries)) continue;
			await walkDir(fullPath, baseDir, entries);
		} else if (s.isFile() && item.endsWith(".md") && item !== "SKILL.md") {
			await tryAddAgent(fullPath, item, baseDir, entries);
		}
	}
}

async function tryAddSkill(
	fullPath: string,
	baseDir: string,
	entries: IndexEntry[],
): Promise<boolean> {
	const skillMdPath = join(fullPath, "SKILL.md");
	if (!existsSync(skillMdPath)) return false;

	try {
		const content = await readFile(skillMdPath, "utf-8");
		const fm = parseFrontmatter(content);
		const relPath = relative(baseDir, fullPath);
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
): Promise<void> {
	if (SKIP_MD_FILES.has(item)) return;
	// Skip ALL-CAPS filenames (e.g., CONTRIBUTING.md)
	const upperBase = basename(item);
	if (upperBase === upperBase.toUpperCase() && upperBase !== upperBase.toLowerCase()) return;

	try {
		const content = await readFile(fullPath, "utf-8");
		const fm = parseFrontmatter(content);
		if (!fm || (!fm.name && !fm.skills)) return;
		const relPath = relative(baseDir, fullPath);
		const name = fm.name ?? basename(item, ".md");
		const entry: IndexEntry = { name, type: "agent", path: relPath };
		if (fm.description) entry.description = fm.description;
		entries.push(entry);
	} catch {
		// Skip unreadable
	}
}
