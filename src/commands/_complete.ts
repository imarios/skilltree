/**
 * Hidden `_complete` subcommand — backs dynamic shell completion.
 *
 * Hard requirements (this runs on every <TAB>):
 *  - MUST NOT throw user-facing errors. A failing call would pollute the
 *    user's shell with stack traces. Any error (missing manifest, bad
 *    YAML, IO error) collapses to no suggestions; the shell falls back to
 *    its default completion.
 *  - MUST stay fast. No network, no git, no resolution — just the
 *    manifest read.
 *  - MUST NOT use `process.cwd()` for global completion. When the user
 *    tabs `skilltree remove --global <TAB>` from anywhere, we go straight
 *    to `~/.skilltree/global.yaml`.
 */

import { getKnownAgentNames } from "../core/agents.js";
import { getAllDependencyNames, readGlobalManifest, readManifest } from "../core/manifest.js";
import type { Manifest } from "../types.js";

export const COMPLETE_KINDS = ["deps", "targets", "agents"] as const;
export type CompleteKind = (typeof COMPLETE_KINDS)[number];

export function isCompleteKind(value: string): value is CompleteKind {
	return COMPLETE_KINDS.includes(value as CompleteKind);
}

export interface CompleteOptions {
	global?: boolean;
	dir?: string; // override CWD (testing)
	globalDir?: string; // override ~/.skilltree (testing)
}

/**
 * Print completion suggestions to stdout, one per line. Validates `kind`
 * at the boundary; unknown kinds are silent (never break the shell).
 */
export async function completeCommand(kind: string, opts: CompleteOptions = {}): Promise<void> {
	if (!isCompleteKind(kind)) return;
	const suggestions = await getSuggestions(kind, opts);
	if (suggestions.length === 0) return;
	process.stdout.write(`${suggestions.join("\n")}\n`);
}

/**
 * Pure helper exposed for tests. Errors and unknown kinds collapse to `[]`.
 */
export async function getSuggestions(
	kind: CompleteKind,
	opts: CompleteOptions = {},
): Promise<string[]> {
	try {
		switch (kind) {
			case "deps":
				return getAllDependencyNames(await loadManifest(opts));
			case "targets":
				return [...((await loadManifest(opts)).install_targets ?? [])].sort();
			case "agents":
				return getKnownAgentNames();
			default:
				kind satisfies never;
				return [];
		}
	} catch {
		return [];
	}
}

function loadManifest(opts: CompleteOptions): Promise<Manifest> {
	return opts.global ? readGlobalManifest(opts.globalDir) : readManifest(opts.dir ?? process.cwd());
}
