import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Add entries to .gitignore (deduplication: skips entries that already exist).
 */
export async function addGitignoreEntries(dir: string, entries: string[]): Promise<string[]> {
	const gitignorePath = join(dir, ".gitignore");
	let content = "";
	try {
		content = await readFile(gitignorePath, "utf-8");
	} catch {
		// .gitignore doesn't exist yet
	}

	const lines = content.split("\n");
	const added: string[] = [];

	for (const entry of entries) {
		if (!lines.some((line) => line.trim() === entry)) {
			added.push(entry);
		}
	}

	if (added.length > 0) {
		const suffix = content.endsWith("\n") || content === "" ? "" : "\n";
		await writeFile(gitignorePath, `${content}${suffix}${added.join("\n")}\n`, "utf-8");
	}

	return added;
}

/**
 * Remove entries from .gitignore.
 */
export async function removeGitignoreEntries(dir: string, entries: string[]): Promise<string[]> {
	const gitignorePath = join(dir, ".gitignore");
	let content: string;
	try {
		content = await readFile(gitignorePath, "utf-8");
	} catch {
		return []; // No .gitignore, nothing to remove
	}

	const entrySet = new Set(entries.map((e) => e.trim()));
	const lines = content.split("\n");
	const filtered = lines.filter((line) => !entrySet.has(line.trim()));
	const removed = entries.filter((e) => lines.some((l) => l.trim() === e));

	if (removed.length > 0) {
		await writeFile(gitignorePath, filtered.join("\n"), "utf-8");
	}

	return removed;
}

/**
 * Get the gitignore entries for a given install path.
 *
 * Returns one entry per managed resource directory (`skills/`, `agents/`,
 * `commands/`) so installed artifacts stay out of git. The function name
 * is kept for backwards compatibility — it covers all three resource
 * types, not just skills+agents.
 */
export function getSkillAgentIgnoreEntries(installPath: string): string[] {
	const base = installPath.replace(/\/$/, "");
	return [`${base}/skills/`, `${base}/agents/`, `${base}/commands/`];
}
