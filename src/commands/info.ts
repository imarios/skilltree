import semver from "semver";
import { listTags } from "../core/git.js";
import { getRegistryRepoDir, readRegistryIndex } from "../core/registry-cache.js";
import { listRegistries } from "../core/registry-config.js";
import { dim, label, pc } from "../core/ui.js";
import type { IndexEntry } from "../types.js";

interface InfoMatch {
	entity: IndexEntry;
	registry: string;
	repo: string;
}

export async function infoCommand(
	name: string,
	opts?: { json?: boolean },
	configPath?: string,
	cacheDir?: string,
): Promise<void> {
	const registries = await listRegistries(configPath);

	if (registries.length === 0) {
		throw new Error("No registries configured. Run 'skilltree registry add <url>' to add one.");
	}

	const matches = await findMatches(name, registries, cacheDir);

	if (matches.length === 0) {
		if (opts?.json) {
			console.log("[]");
			return;
		}
		throw new Error(
			`"${name}" not found in any registry.\nRun 'skilltree search <query>' to find available skills.`,
		);
	}

	if (opts?.json) {
		await printJsonInfo(matches, cacheDir);
		return;
	}

	if (matches.length === 1) {
		await printSingleMatch(matches[0] as InfoMatch, name, cacheDir);
	} else {
		printMultipleMatches(matches, name);
	}
}

async function findMatches(
	name: string,
	registries: Array<{ name: string; repo: string }>,
	cacheDir?: string,
): Promise<InfoMatch[]> {
	const matches: InfoMatch[] = [];
	for (const reg of registries) {
		const index = await readRegistryIndex(reg.name, cacheDir);
		if (!index) continue;
		for (const entity of index.entities) {
			if (entity.name === name) {
				matches.push({ entity, registry: reg.name, repo: reg.repo });
			}
		}
	}
	return matches;
}

async function fetchVersions(registry: string, cacheDir?: string): Promise<string[]> {
	try {
		const repoDir = getRegistryRepoDir(registry, cacheDir);
		const tags = await listTags(repoDir);
		return tags
			.map((t) => t.replace(/^v/, ""))
			.filter((t) => semver.valid(t) !== null)
			.sort((a, b) => semver.rcompare(a, b));
	} catch {
		return [];
	}
}

async function printJsonInfo(matches: InfoMatch[], cacheDir?: string): Promise<void> {
	const jsonResults = await Promise.all(
		matches.map(async (m) => {
			const result: Record<string, unknown> = { ...m.entity, registry: m.registry, repo: m.repo };
			const versions = await fetchVersions(m.registry, cacheDir);
			if (versions.length > 0) {
				result.versions = versions;
				result.latest = versions[0];
			}
			return result;
		}),
	);
	console.log(JSON.stringify(jsonResults, null, 2));
}

async function printSingleMatch(m: InfoMatch, name: string, cacheDir?: string): Promise<void> {
	console.log(`  ${pc.bold(m.entity.name)} ${dim(`(${m.entity.type})`)}`);
	console.log(`  ${label("Registry:")}     ${m.registry} ${dim(`(${m.repo})`)}`);
	console.log(`  ${label("Path:")}         ${m.entity.path}`);
	if (m.entity.description) {
		console.log(`  ${label("Description:")}  ${m.entity.description}`);
	}
	if (m.entity.tags?.length) {
		console.log(`  ${label("Tags:")}         ${m.entity.tags.join(", ")}`);
	}

	const versions = await fetchVersions(m.registry, cacheDir);
	if (versions.length > 0) {
		console.log(`  ${label("Versions:")}     ${versions.slice(0, 10).join(", ")}`);
		console.log(`  ${label("Latest:")}       ${pc.green(versions[0] ?? "")}`);
	}

	console.log();
	console.log(`  ${pc.cyan(`→ skilltree add ${name} --repo ${m.repo} --path ${m.entity.path}`)}`);
}

function printMultipleMatches(matches: InfoMatch[], name: string): void {
	console.log(`  Found in ${pc.bold(String(matches.length))} registries:\n`);
	for (let i = 0; i < matches.length; i++) {
		const m = matches[i] as InfoMatch;
		console.log(
			`  ${pc.bold(`[${i + 1}]`)} ${pc.bold(m.entity.name)} ${dim(`(${m.entity.type})`)} — ${m.registry}`,
		);
		console.log(`      ${dim(`${m.repo} :: ${m.entity.path}`)}`);
		if (m.entity.description) {
			console.log(`      ${m.entity.description}`);
		}
		console.log(
			`      ${pc.cyan(`→ skilltree add ${name} --repo ${m.repo} --path ${m.entity.path}`)}`,
		);
		console.log();
	}
}
