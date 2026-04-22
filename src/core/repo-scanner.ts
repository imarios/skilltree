import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import type { EntityType } from "../types.js";
import { parseFrontmatter } from "./frontmatter.js";
import { SKIP_MD_FILES } from "./registry-scanner.js";

/**
 * A discovered skill or agent in the local filesystem.
 * Mirrors IndexEntry's shape but `path` is always POSIX-style relative
 * to the scan root (so it can be written into skilltree.yaml as-is).
 */
export interface LocalEntry {
	name: string;
	type: EntityType;
	/** POSIX-style path relative to the scan root. For skills, the dir containing SKILL.md. For agents, the .md file itself. */
	path: string;
	description?: string;
}

/**
 * Directory names to skip during scan. Hidden dirs (`.*`) are skipped
 * separately — these are the common build/vendor dirs that are not
 * hidden but still never hold source skills or agents.
 */
const EXCLUDED_DIRS = new Set([
	"node_modules",
	"dist",
	"build",
	"coverage",
	"target",
	"out",
	"vendor",
]);

/**
 * Walk a repo directory looking for SKILL.md files (skills) and standalone
 * .md files with a `name` frontmatter field (agents).
 *
 * Excludes hidden directories (`.claude/`, `.git/`, `.github/`, etc.) so
 * installed artifacts are never picked up as sources.
 *
 * Malformed frontmatter on a single file does not abort the scan; that
 * file is skipped and others continue. Results are sorted deterministically
 * by (type, name) so the CLI can present them in a stable order.
 */
export async function scanLocalRepo(rootDir: string): Promise<LocalEntry[]> {
	const entries: LocalEntry[] = [];
	await walk(rootDir, rootDir, entries);
	entries.sort((a, b) => {
		if (a.type !== b.type) return a.type.localeCompare(b.type);
		return a.name.localeCompare(b.name);
	});
	return entries;
}

async function walk(rootDir: string, currentDir: string, out: LocalEntry[]): Promise<void> {
	let dirents: Dirent[];
	try {
		dirents = (await readdir(currentDir, { withFileTypes: true })) as Dirent[];
	} catch {
		return;
	}

	for (const dirent of dirents) {
		const fullPath = join(currentDir, dirent.name);

		if (dirent.isDirectory()) {
			if (dirent.name.startsWith(".")) continue;
			if (EXCLUDED_DIRS.has(dirent.name)) continue;
			await walk(rootDir, fullPath, out);
			continue;
		}

		if (!dirent.isFile()) continue;
		if (!dirent.name.endsWith(".md")) continue;

		const entry = await classifyMdFile(rootDir, fullPath, dirent.name);
		if (entry) out.push(entry);
	}
}

async function classifyMdFile(
	rootDir: string,
	fullPath: string,
	baseName: string,
): Promise<LocalEntry | null> {
	const isSkillFile = baseName === "SKILL.md";

	if (!isSkillFile && SKIP_MD_FILES.has(baseName)) return null;

	let content: string;
	try {
		content = await readFile(fullPath, "utf-8");
	} catch {
		return null;
	}

	let fm: ReturnType<typeof parseFrontmatter>;
	try {
		fm = parseFrontmatter(content);
	} catch {
		// Malformed frontmatter — skip this file, not the whole scan.
		return null;
	}

	const relPath = toPosix(relative(rootDir, fullPath));

	if (isSkillFile) {
		const skillDir = dirname(relPath);
		const name = fm?.name ?? basename(skillDir === "." ? rootDir : skillDir);
		const entry: LocalEntry = {
			name,
			type: "skill",
			path: skillDir === "" ? "." : skillDir,
		};
		if (fm?.description) entry.description = fm.description;
		return entry;
	}

	// Agent candidate — require a name in frontmatter. Without one we have
	// no stable identifier and the file is probably not an agent anyway.
	if (!fm?.name) return null;

	const entry: LocalEntry = {
		name: fm.name,
		type: "agent",
		path: relPath,
	};
	if (fm.description) entry.description = fm.description;
	return entry;
}

function toPosix(p: string): string {
	return sep === "/" ? p : p.split(sep).join("/");
}
