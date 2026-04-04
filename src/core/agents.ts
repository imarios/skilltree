import { stat } from "node:fs/promises";
import { join } from "node:path";
import { expandTilde, isLocalSource } from "./paths.js";

interface AgentEntry {
	dir: string;
	globalHome: string;
}

/**
 * Built-in registry mapping known AI coding agent names to their directory paths.
 * Project-level: `dir` is relative to project root (e.g., ".claude").
 * Global-level: `globalHome` is the user's home directory path (e.g., "~/.claude").
 */
export const AGENT_REGISTRY: Record<string, AgentEntry> = {
	claude: { dir: ".claude", globalHome: "~/.claude" },
	codex: { dir: ".codex", globalHome: "~/.codex" },
	copilot: { dir: ".copilot", globalHome: "~/.copilot" },
	cursor: { dir: ".cursor", globalHome: "~/.cursor" },
	gemini: { dir: ".gemini", globalHome: "~/.gemini" },
	windsurf: { dir: ".windsurf", globalHome: "~/.windsurf" },
};

function lookupAgent(target: string): AgentEntry {
	const entry = AGENT_REGISTRY[target];
	if (!entry) {
		throw new Error(`unknown agent '${target}' — use ./${target} for a custom path`);
	}
	return entry;
}

/**
 * Resolve an install target to a project-level directory path.
 * - Literal path (starts with ./, /, or ~/) → passed through unchanged
 * - Bare word (e.g., "claude") → agent registry lookup → ".claude"
 * - Unknown bare word → error with helpful message
 */
export function resolveTarget(target: string): string {
	if (isLocalSource(target)) return target;
	return lookupAgent(target).dir;
}

/**
 * Resolve an install target to a global (home directory) path.
 * - Literal path (starts with ./, /, or ~/) → passed through unchanged
 * - Bare word (e.g., "claude") → agent registry lookup → expanded "~/.claude"
 * - Unknown bare word → error with helpful message
 */
export function resolveGlobalTarget(target: string): string {
	if (isLocalSource(target)) return target;
	return expandTilde(lookupAgent(target).globalHome);
}

/**
 * Reverse lookup: map a directory path back to an agent name.
 * Returns null if the path doesn't match any known agent.
 */
export function pathToAgentName(path: string): string | null {
	for (const [name, entry] of Object.entries(AGENT_REGISTRY)) {
		if (path === entry.dir) return name;
	}
	return null;
}

/**
 * Detect which known agents are installed by checking for their
 * home directories. Defaults to checking in the user's home directory,
 * but accepts an override for testing.
 */
export async function detectInstalledAgents(homeDir?: string): Promise<string[]> {
	const base = homeDir ?? expandTilde("~");

	const results = await Promise.all(
		Object.entries(AGENT_REGISTRY).map(async ([name, entry]) => {
			try {
				const s = await stat(join(base, entry.dir));
				return s.isDirectory() ? name : null;
			} catch {
				return null;
			}
		}),
	);

	return results.filter((name): name is string => name !== null);
}

/**
 * Return all known agent names, sorted alphabetically.
 */
export function getKnownAgentNames(): string[] {
	return Object.keys(AGENT_REGISTRY).sort();
}
