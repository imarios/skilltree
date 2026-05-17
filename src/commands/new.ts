import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dim, success } from "../core/ui.js";
import type { EntityType } from "../types.js";
import { addCommand } from "./add.js";

export interface NewOptions {
	/** Register as dev-dependency (delegates to `addCommand` with --dev). */
	dev?: boolean;
	/**
	 * Default `true`. Set to `false` by `--no-register` to scaffold the file
	 * without touching the manifest. Mirrors Commander's negated-flag idiom
	 * (the action receives `register: false` when the user passes
	 * `--no-register`).
	 */
	register?: boolean;
}

/**
 * Scaffold a new skill, agent, or command at the conventional path with a
 * valid frontmatter template, then (by default) auto-register it as a local
 * dependency. Entry point for the author lifecycle. Issue #82 — part of
 * Authoring UX v1 (#78).
 *
 * Behaviour summary:
 *   - Validates `type` and `name` up front (no partial scaffolds on bad input).
 *   - Refuses to overwrite an existing target file (R2 of the issue).
 *   - Writes the type-specific template through {@link renderTemplate}.
 *   - Delegates registration to {@link addCommand} so we inherit its
 *     overwrite/cross-group checks and stay in sync if `add` evolves.
 */
export async function newCommand(
	type: EntityType,
	name: string,
	opts: NewOptions,
	dir: string,
): Promise<void> {
	validateEntityType(type);
	validateName(name);

	const target = resolveTargetPath(type, name, dir);
	await assertNoCollision(target.displayPath, target.absPath);

	const template = renderTemplate(type, name);
	await mkdir(dirname(target.absPath), { recursive: true });
	await writeFile(target.absPath, template, "utf-8");

	success(`Created ${type} "${name}" at ${target.displayPath}`);

	// `--no-register` short-circuit. We've already created the file, so a clean
	// return is the right thing — the user explicitly asked for scaffold-only.
	if (opts.register === false) {
		console.log(
			dim(
				`  Skipped manifest registration (--no-register). Add it later with \`skilltree add ${name} --local ${target.localPath} --type ${type}\`.`,
			),
		);
		return;
	}

	// Delegate to `addCommand` so we get its overwrite checks, cross-group
	// guard, and orthogonal-field preservation for free. Behaviourally
	// identical to the user hand-running `skilltree add` next.
	await addCommand(
		name,
		{
			local: target.localPath,
			type,
			dev: opts.dev,
		},
		dir,
	);
}

/**
 * Throw if `type` isn't one of the three known entity kinds. `assert` style
 * so callers downstream can narrow without an extra cast.
 */
function validateEntityType(type: string | undefined): asserts type is EntityType {
	if (type !== "skill" && type !== "agent" && type !== "command") {
		const got = type === undefined || type === "" ? "<empty>" : type;
		throw new Error(`Invalid type "${got}". Must be one of: skill, agent, command.`);
	}
}

/**
 * Conservative naming policy: kebab-case-friendly identifiers only. Must
 * start with a letter or digit and contain only letters, digits, hyphens,
 * and underscores. This is intentionally stricter than what YAML keys
 * accept so the same string is safe as:
 *   - a path segment (no `/`, `..`, spaces),
 *   - a YAML manifest key (no quoting needed),
 *   - a registry index entry (URL-safe).
 */
const NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function validateName(name: string): void {
	if (!name || !NAME_REGEX.test(name)) {
		throw new Error(
			`Invalid name "${name}". Names must start with a letter or digit and contain only letters, digits, hyphens, and underscores.`,
		);
	}
}

interface TargetPath {
	/** Absolute filesystem path to the file we will write. */
	absPath: string;
	/** Project-root-relative path for user-facing messages. */
	displayPath: string;
	/**
	 * Value passed to `addCommand` as `--local`. Skills get the directory
	 * (`./skills/foo`); agents/commands get the file (`./agents/foo.md`).
	 * This mirrors how authors write `local:` by hand today.
	 */
	localPath: string;
}

function resolveTargetPath(type: EntityType, name: string, dir: string): TargetPath {
	if (type === "skill") {
		const relDir = `skills/${name}`;
		return {
			absPath: join(dir, relDir, "SKILL.md"),
			displayPath: `${relDir}/SKILL.md`,
			localPath: `./${relDir}`,
		};
	}
	const subdir = type === "agent" ? "agents" : "commands";
	const rel = `${subdir}/${name}.md`;
	return {
		absPath: join(dir, rel),
		displayPath: rel,
		localPath: `./${rel}`,
	};
}

async function assertNoCollision(displayPath: string, absPath: string): Promise<void> {
	try {
		await stat(absPath);
	} catch {
		return; // ENOENT (or unreadable) — treat as "safe to write".
	}
	throw new Error(
		`"${displayPath}" already exists. Choose a different name or remove the existing entry.`,
	);
}

/**
 * Per-type frontmatter templates. Each must pass `validateFrontmatter`
 * cleanly (no warnings) — the contract is exercised by
 * `tests/commands/new.test.ts`.
 *
 *   - Skill: `dependencies: []` is the SKILL.md convention.
 *   - Agent: `skills: []` is the agent .md convention.
 *   - Command: no relations field — commands declare no transitive deps today.
 */
function renderTemplate(type: EntityType, name: string): string {
	if (type === "skill") {
		return `---
name: ${name}
description: TODO — one-line description of what this skill does
dependencies: []
---

# ${name}

TODO: skill body.
`;
	}
	if (type === "agent") {
		return `---
name: ${name}
description: TODO — one-line description
skills: []
---

# ${name}

TODO: agent body.
`;
	}
	return `---
name: ${name}
description: TODO — one-line description
---

# /${name}

TODO: command body.
`;
}
