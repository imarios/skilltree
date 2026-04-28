import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
			writeFile(join(targetDir, relPath), content, "utf-8"),
		),
	);
	return targetDir;
}
