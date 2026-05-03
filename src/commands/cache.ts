import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { getCacheDir } from "../core/git.js";
import { success } from "../core/ui.js";

export interface CacheCleanOptions {
	json?: boolean;
	/** Test override; defaults to {@link getCacheDir}. */
	cacheDir?: string;
}

interface CacheCleanResult {
	cleaned: boolean;
	path: string;
	bytesFreed: number;
}

/**
 * Best-effort recursive byte count. Returns 0 for any I/O error so the caller
 * never has to distinguish "missing" from "transient stat failure".
 */
async function measureDirSize(path: string): Promise<number> {
	try {
		const s = await stat(path);
		if (!s.isDirectory()) return s.size;
		const entries = await readdir(path, { withFileTypes: true });
		const sizes = await Promise.all(entries.map((entry) => measureDirSize(join(path, entry.name))));
		return sizes.reduce((a, b) => a + b, 0);
	} catch {
		return 0;
	}
}

export async function cacheCleanCommand(opts?: CacheCleanOptions): Promise<void> {
	const cacheDir = opts?.cacheDir ?? getCacheDir();

	// Only walk the cache when the caller actually wants the byte count —
	// otherwise this is O(N files) of stats with the result discarded.
	const bytesFreed = opts?.json ? await measureDirSize(cacheDir) : 0;

	let cleaned = false;
	try {
		await rm(cacheDir, { recursive: true });
		cleaned = true;
	} catch {
		// Already absent — both paths converge on "nothing left to clean".
	}

	if (opts?.json) {
		const result: CacheCleanResult = {
			cleaned,
			path: cacheDir,
			bytesFreed: cleaned ? bytesFreed : 0,
		};
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	if (cleaned) {
		success(`Removed cache at ${cacheDir}`);
	} else {
		console.log("Cache is already clean.");
	}
}
