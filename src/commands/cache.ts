import { rm } from "node:fs/promises";
import { getCacheDir } from "../core/git.js";
import { success } from "../core/ui.js";

export async function cacheCleanCommand(): Promise<void> {
	const cacheDir = getCacheDir();
	try {
		await rm(cacheDir, { recursive: true });
		success(`Removed cache at ${cacheDir}`);
	} catch {
		console.log("Cache is already clean.");
	}
}
