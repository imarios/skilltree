import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import semver from "semver";
import pkg from "../../package.json" with { type: "json" };
import commandsMd from "../../skills/skilltree/references/commands.md" with { type: "text" };
import workflowsMd from "../../skills/skilltree/references/workflows.md" with { type: "text" };
import skillMd from "../../skills/skilltree/SKILL.md" with { type: "text" };
import { resolveAgentHome } from "./agents.js";
import { parseFrontmatter } from "./frontmatter.js";

/**
 * Skill files embedded into the compiled binary at build time. When adding
 * a new file under `skills/skilltree/`, add a matching text import above
 * and an entry here — otherwise the binary will ship an incomplete skill.
 */
const BUNDLED_FILES: ReadonlyArray<readonly [string, string]> = [
	["SKILL.md", skillMd],
	["references/commands.md", commandsMd],
	["references/workflows.md", workflowsMd],
];

/**
 * Inject (or replace) a `version:` line in the SKILL.md frontmatter so the
 * materialized copy carries the CLI version that wrote it. Doctor's
 * bundled-skill check reads this to detect a stale installed skill
 * (Fluorine).
 *
 * Operates on the raw text — preserves byte order and comments outside the
 * frontmatter block. If there is no leading `---` block, returns the input
 * unchanged (defensive; the bundled SKILL.md always has one).
 */
export function injectSkillVersion(text: string, version: string): string {
	const head = text.startsWith("---\n") ? "---\n" : text.startsWith("---\r\n") ? "---\r\n" : null;
	if (head === null) return text;
	const afterOpen = head.length;
	const closeIdx = text.indexOf("\n---", afterOpen);
	if (closeIdx === -1) return text;
	const block = text.slice(afterOpen, closeIdx);
	const rest = text.slice(closeIdx);
	const versionLine = `version: "${version}"`;
	let newBlock: string;
	if (/^version:.*$/m.test(block)) {
		newBlock = block.replace(/^version:.*$/m, versionLine);
	} else if (/^name:.*$/m.test(block)) {
		newBlock = block.replace(/^(name:.*)$/m, `$1\n${versionLine}`);
	} else {
		newBlock = `${versionLine}\n${block}`;
	}
	return `${head}${newBlock}${rest}`;
}

function stampedContent(relPath: string, content: string): string {
	if (relPath !== "SKILL.md") return content;
	return injectSkillVersion(content, pkg.version);
}

/**
 * Write the embedded skilltree skill into `targetDir`. Existing files are
 * overwritten so re-running `skilltree teach` refreshes the bundle after
 * a binary upgrade.
 */
export async function materializeBundledSkill(targetDir: string): Promise<string> {
	const dirs = new Set<string>();
	for (const [relPath] of BUNDLED_FILES) {
		dirs.add(dirname(join(targetDir, relPath)));
	}
	await Promise.all(Array.from(dirs, (d) => mkdir(d, { recursive: true })));
	await Promise.all(
		BUNDLED_FILES.map(([relPath, content]) =>
			writeFile(join(targetDir, relPath), stampedContent(relPath, content), "utf-8"),
		),
	);
	return targetDir;
}

/**
 * What an agent has installed of the bundled skilltree skill.
 *
 * Shared by `doctor`'s bundled-skill check, which reports every non-current
 * state, and by `init` (#157), which offers `teach` when the skill is missing.
 * One definition so the two can never disagree about what "installed" means.
 */
export type AgentSkillState =
	| { agent: string; kind: "current"; version: string }
	| { agent: string; kind: "stale"; version: string }
	| { agent: string; kind: "missing" }
	| { agent: string; kind: "no-version" }
	| { agent: string; kind: "error"; message: string };

export async function inspectAgentSkill(
	agent: string,
	homeDir: string | undefined,
): Promise<AgentSkillState> {
	const agentHome = resolveAgentHome(agent, homeDir);
	if (agentHome === null) {
		// Unknown agent — detectInstalledAgents wouldn't return it, but stay
		// defensive in case the registry changes asymmetrically.
		return { agent, kind: "error", message: "unknown agent" };
	}
	const skillPath = join(agentHome, "skills", "skilltree", "SKILL.md");
	let text: string;
	try {
		text = await readFile(skillPath, "utf-8");
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return { agent, kind: "missing" };
		return { agent, kind: "error", message: err instanceof Error ? err.message : String(err) };
	}
	let fm: ReturnType<typeof parseFrontmatter>;
	try {
		fm = parseFrontmatter(text);
	} catch (err) {
		return { agent, kind: "error", message: err instanceof Error ? err.message : String(err) };
	}
	// Presence check on the parsed string (CLAUDE.md §"Presence check ≠ value
	// check"): `version` may legitimately be undefined, or it may be present
	// but un-parseable (legacy install, hand-edited file). Treat both as
	// "predates version tracking" so the user gets the same remediation.
	const installed = fm?.version;
	if (installed === undefined) return { agent, kind: "no-version" };
	if (!semver.valid(installed)) return { agent, kind: "no-version" };
	if (semver.lt(installed, pkg.version)) {
		return { agent, kind: "stale", version: installed };
	}
	return { agent, kind: "current", version: installed };
}
