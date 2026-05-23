import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import commandsMd from "../../skills/skilltree/references/commands.md" with { type: "text" };
import workflowsMd from "../../skills/skilltree/references/workflows.md" with { type: "text" };
import skillMd from "../../skills/skilltree/SKILL.md" with { type: "text" };

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
