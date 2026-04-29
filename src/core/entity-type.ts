/**
 * Helpers that classify entities by their EntityType.
 *
 * Centralized so that adding a fourth resource type (or changing the
 * directory naming convention) is a one-file edit instead of a sweep
 * across the install path, the resolvers, the scanners, and the
 * gitignore generator.
 *
 * Lives in its own module rather than `paths.ts` because it bridges
 * `EntityType` (a domain concept from `types.ts`) and the path/layout
 * conventions — neither side owns the logic outright.
 */

import type { EntityType } from "../types.js";

/**
 * Disambiguate a single `.md` artifact between an agent and a command
 * by looking at its path. Files under any `commands/` segment are
 * Claude Code slash-commands; everything else defaults to agent —
 * matching prior behavior for non-command `.md` files.
 */
export function mdFileType(path: string): "agent" | "command" {
	return path.split("/").includes("commands") ? "command" : "agent";
}

/**
 * True when the entity's source artifact is a single `.md` file rather
 * than a directory. Skills are directories containing `SKILL.md`; agents
 * and commands are single `.md` files. Use at every site that branches
 * "directory vs single file" — silently breaks if a future entity type
 * is added without updating this predicate.
 */
export function isSingleFileEntity(type: EntityType): boolean {
	return type === "agent" || type === "command";
}

/**
 * Conventional-probe paths for resolving a bare entity name to a path
 * within a repo (or repo-like tree). Order matters — first match wins,
 * and the order encodes the "skills > agents > commands > root" priority
 * the resolver has used since the original layout.
 */
export function conventionalCandidates(name: string): string[] {
	return [`skills/${name}`, `agents/${name}.md`, `commands/${name}.md`, name];
}
