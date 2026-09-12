import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Redirect `$HOME` for the whole test run.
 *
 * `install --global` resolves its targets through `expandTilde("~/.claude")`.
 * Before this existed, every test that reached that path wrote into the
 * developer's real `~/.claude/skills/` — overwriting whatever `skilltree
 * teach` had installed and leaving behind symlinks into temp directories that
 * the test then deleted. Claude Code reads that directory, so the damage was
 * visible outside the test run.
 *
 * Loaded via `bunfig.toml`'s `[test] preload`, so it applies to every test
 * file without each one having to opt in.
 *
 * This only redirects helpers that read `$HOME` at call time (see `homeDir`
 * in `src/core/paths.ts`). Bun caches `os.homedir()` at process start, so a
 * preload cannot change what that returns.
 */
const sandbox = join(tmpdir(), `skilltree-test-home-${process.pid}`);
mkdirSync(sandbox, { recursive: true });
process.env.HOME = sandbox;

// Don't leave one of these behind per run.
process.on("exit", () => {
	try {
		rmSync(sandbox, { recursive: true, force: true });
	} catch {
		// Best effort — a leftover temp dir is not worth failing a test run.
	}
});
