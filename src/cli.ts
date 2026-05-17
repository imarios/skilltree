#!/usr/bin/env bun
import { Command } from "commander";
import pkg from "../package.json";
import { completeCommand } from "./commands/_complete.js";
import { addCommand } from "./commands/add.js";
import { cacheCleanCommand } from "./commands/cache.js";
import { checkCommand } from "./commands/check.js";
import { completionCommand } from "./commands/completion.js";
import { depsTreeCommand } from "./commands/deps.js";
import { doctorCommand } from "./commands/doctor.js";
import { indexCommand } from "./commands/index-cmd.js";
import { infoCommand } from "./commands/info.js";
import { initCommand } from "./commands/init.js";
import { installCommand } from "./commands/install.js";
import { listCommand } from "./commands/list.js";
import { newCommand } from "./commands/new.js";
import { outdatedCommand } from "./commands/outdated.js";
import { projectsCommand } from "./commands/projects.js";
import {
	registryAddCommand,
	registryInitCommand,
	registryListCommand,
	registryRemoveCommand,
	registryUpdateCommand,
	resolveRegistryAddUrl,
} from "./commands/registry.js";
import { removeCommand } from "./commands/remove.js";
import { scanCommand } from "./commands/scan.js";
import { searchCommand } from "./commands/search.js";
import {
	targetsAddCommand,
	targetsDetectCommand,
	targetsListCommand,
	targetsMigrateCommand,
	targetsRemoveCommand,
} from "./commands/targets.js";
import { teachCommand } from "./commands/teach.js";
import { updateCommand } from "./commands/update.js";
import { unvendorCommand, vendorCommand } from "./commands/vendor.js";
import { verifyCommand } from "./commands/verify.js";
import { whyCommand } from "./commands/why.js";
import { pc } from "./core/ui.js";
import type { EntityType } from "./types.js";

/**
 * Build the full Commander program tree without invoking it. Exported so
 * tests can introspect commands, options, and help output (snapshot +
 * parity tests in `tests/cli/`) without spawning the binary.
 */
export function buildProgram(): Command {
	const program = new Command();

	program
		.name("skilltree")
		.description("Dependency manager for AI agent skills")
		.version(pkg.version)
		.enablePositionalOptions()
		.passThroughOptions();

	program
		.command("init")
		.description(
			"Initialize a new skilltree project\n\nRelated:\n  registry init   — seed popular community registries to install skills from\n  targets detect  — auto-discover installed coding agents on this machine",
		)
		.option("-g, --global", "Initialize global dependencies")
		.option(
			"--scan",
			"Scan the repo for existing skills, agents, and commands and register them as local deps",
		)
		.option(
			"-y, --yes",
			"Skip prompts: include all discovered scan entries and enrol all detected agents",
		)
		.option("-f, --force", "Overwrite an existing skilltree.yml")
		.option(
			"--target <name>",
			"Explicit install target (skips detection). Repeat for multiple, e.g. --target claude --target codex",
			(value: string, prev: string[] = []) => prev.concat(value),
		)
		.action(async (opts) => {
			await initCommand(process.cwd(), {
				global: opts.global,
				scan: opts.scan,
				yes: opts.yes,
				force: opts.force,
				targets: opts.target,
			});
		});

	program
		.command("add <name>")
		.description("Add a dependency")
		.option("-r, --repo <url>", "Git repository URL")
		.option("--source <alias>", "Source alias (from sources: map)")
		.option("-p, --path <path>", "Path within the repository")
		.option("-v, --version <constraint>", "Semver version constraint")
		.option("-l, --local <path>", "Local filesystem path")
		.option("-D, --dev", "Add as dev dependency")
		.option("-t, --type <type>", "Entity type (skill, agent, or command)")
		.option("--registry <name>", "Resolve from this registry (when no --repo)")
		.option("-g, --global", "Add to global dependencies")
		.option("-y, --yes", "Skip the glob-mode confirmation prompt")
		.option("--no-verify", "Skip git ls-remote reachability check on --repo URLs")
		.action(async (name: string, opts) => {
			// Commander turns `--no-verify` into `opts.verify === false`. Translate
			// to the `noVerify` flag the command expects so the rest of the option
			// surface stays consistent with `--no-register` / `--no-X` idioms used
			// elsewhere.
			await addCommand(name, { ...opts, noVerify: opts.verify === false }, process.cwd());
		});

	// `new` accepts two equivalent forms:
	//   skilltree new <skill|agent|command> <name>      (subcommand form)
	//   skilltree new <name> --type <skill|agent|command>
	// Implemented as a single command with two positionals because nested
	// subcommands would still leave the `--type` form needing a separate
	// registration. Sniffing happens in the action handler. Issue #82.
	program
		.command("new <typeOrName> [name]")
		.description(
			"Scaffold a new skill, agent, or command with valid frontmatter\n\n" +
				"Forms:\n" +
				"  skilltree new skill <name>      (writes skills/<name>/SKILL.md)\n" +
				"  skilltree new agent <name>      (writes agents/<name>.md)\n" +
				"  skilltree new command <name>    (writes commands/<name>.md)\n" +
				"  skilltree new <name> --type <type>",
		)
		.option("-D, --dev", "Register as dev-dependency")
		.option("--no-register", "Scaffold only; skip the implicit `add --local`")
		.option("-t, --type <type>", "Entity type (alternative to the subcommand form)")
		.action(async (typeOrName: string, name: string | undefined, opts) => {
			const knownTypes = new Set<EntityType>(["skill", "agent", "command"]);
			let type: EntityType;
			let entityName: string;

			if (name !== undefined) {
				// Subcommand form — first positional must be a known type.
				if (!knownTypes.has(typeOrName as EntityType)) {
					throw new Error(
						`Unknown entity type "${typeOrName}". Use one of: skill, agent, command.`,
					);
				}
				if (opts.type && opts.type !== typeOrName) {
					throw new Error(
						`Cannot combine subcommand form ("${typeOrName}") with --type ("${opts.type}").`,
					);
				}
				type = typeOrName as EntityType;
				entityName = name;
			} else {
				// `--type` form — first positional is the name.
				if (!opts.type) {
					throw new Error(
						"Missing entity type. Use `skilltree new <skill|agent|command> <name>` or pass --type.",
					);
				}
				type = opts.type as EntityType;
				entityName = typeOrName;
			}

			await newCommand(type, entityName, { dev: opts.dev, register: opts.register }, process.cwd());
		});

	program
		.command("install")
		.description("Resolve and install dependencies")
		.option("--prod", "Install production dependencies only")
		.option("--frozen", "Use lockfile only, error if out of sync")
		.option("-f, --force", "Overwrite locally modified files")
		.option("-n, --dry-run", "Show plan without installing")
		.option("--install-path <path>", "Override install directory")
		.option("-g, --global", "Install global dependencies")
		.action(async (opts) => {
			await installCommand(process.cwd(), {
				prod: opts.prod,
				frozen: opts.frozen,
				force: opts.force,
				dryRun: opts.dryRun,
				installPath: opts.installPath,
				global: opts.global,
			});
		});

	program
		.command("update [name]")
		.description("Update dependencies to latest versions")
		.option("-n, --dry-run", "Preview version bumps without applying")
		.option("-g, --global", "Update global dependencies")
		.action(async (name: string | undefined, opts) => {
			await updateCommand(process.cwd(), name, {
				dryRun: opts.dryRun,
				global: opts.global,
			});
		});

	program
		.command("outdated [name]")
		.description("Preview which deps have newer versions available (read-only)")
		.option("--json", "Output results as JSON")
		.option("--check", "Exit 1 if any drift exists (CI-friendly)")
		.option("-g, --global", "Show global deps")
		.action(async (name: string | undefined, opts) => {
			await outdatedCommand(process.cwd(), name, {
				json: opts.json,
				check: opts.check,
				global: opts.global,
			});
		});

	program
		.command("projects")
		.description("List skilltree-managed projects discoverable on this machine (read-only)")
		.option("--root <path>", "Search root (default: $HOME)")
		.option("--json", "Output results as JSON")
		.action(async (opts) => {
			await projectsCommand({
				root: opts.root,
				json: opts.json,
			});
		});

	program
		.command("remove <name>")
		.description("Remove a dependency")
		.option("-f, --force", "Skip confirmation")
		.option("--keep-files", "Leave installed files in place")
		.option("-n, --dry-run", "Preview the removal without changing anything")
		.option("-g, --global", "Remove from global dependencies")
		.option("-D, --dev", "Only remove from dev-dependencies (mirrors `add -D`)")
		.action(async (name: string, opts) => {
			await removeCommand(name, process.cwd(), {
				force: opts.force,
				keepFiles: opts.keepFiles,
				dryRun: opts.dryRun,
				global: opts.global,
				dev: opts.dev,
			});
		});

	program
		.command("verify")
		.description("Verify installed dependencies against lockfile")
		.option("--json", "Output results as JSON")
		.option("-g, --global", "Verify global dependencies")
		.action(async (opts) => {
			await verifyCommand(process.cwd(), { global: opts.global, json: opts.json });
		});

	program
		.command("check")
		.description("Lint the project's skilltree.yml for design-time issues")
		.option("--strict", "Exit 1 if any warnings are found")
		.action(async (opts) => {
			await checkCommand(process.cwd(), { strict: opts.strict });
		});

	program
		.command("doctor")
		.description(
			"Preflight health check across schema, lint, lockfile, targets, registries, and frontmatter\n\nLifecycle: new → check → doctor → git tag",
		)
		.option("--json", "Output results as JSON")
		.option("-g, --global", "Run against the global manifest")
		.action(async (opts) => {
			await doctorCommand(process.cwd(), { json: opts.json, global: opts.global });
		});

	program
		.command("list")
		.description("List installed dependencies")
		.option("--json", "Output results as JSON")
		.option("-g, --global", "List global dependencies")
		.action(async (opts) => {
			await listCommand(process.cwd(), { json: opts.json, global: opts.global });
		});

	program
		.command("scan [paths...]")
		.description(
			"Scan skills, agents, and commands for undeclared dependencies\n\n" +
				"With no <paths>, scans the project's install-target directories " +
				"(`.claude/skills`, etc.) derived from skilltree.yml. Pass explicit " +
				"paths to scan elsewhere.",
		)
		.option("--check", "Exit 1 if undeclared deps found (pre-commit mode)")
		.option("--apply", "Auto-update frontmatter with detected deps (regex only)")
		.option("--llm", "Use LLM for deep dependency detection (requires ANTHROPIC_API_KEY)")
		.option("--json", "Output results as JSON")
		.action(async (paths: string[], opts) => {
			await scanCommand(paths, {
				check: opts.check,
				apply: opts.apply,
				llm: opts.llm,
				json: opts.json,
			});
		});

	program
		.command("teach")
		.description("Install the skilltree skill to all detected coding agents")
		.option("--agent <agent>", "Install to a specific agent only")
		.action(async (opts) => {
			await teachCommand({ agent: opts.agent });
		});

	// Vendor commands
	program
		.command("vendor")
		.description("Copy all deps as real files for git commit (distribution mode)")
		.option("--frozen", "Use lockfile only, error if out of sync")
		.option("-n, --dry-run", "Show plan without making changes")
		.option(
			"--target <name>",
			"Select install target by raw install_targets entry (e.g. claude, codex). Required when multiple targets are configured.",
		)
		.action(async (opts) => {
			await vendorCommand(process.cwd(), {
				frozen: opts.frozen,
				dryRun: opts.dryRun,
				target: opts.target,
			});
		});

	program
		.command("unvendor")
		.description("Exit vendor mode, restore normal symlinked installs")
		.option("-f, --force", "Discard modified vendored files")
		.option("-n, --dry-run", "Show what would happen without making changes")
		.option(
			"--target <name>",
			"Select install target by raw install_targets entry (e.g. claude, codex). Required when multiple targets are configured.",
		)
		.action(async (opts) => {
			await unvendorCommand(process.cwd(), {
				force: opts.force,
				dryRun: opts.dryRun,
				target: opts.target,
			});
		});

	const deps = program.command("deps").description("Dependency graph commands");

	deps
		.command("tree")
		.description("Show dependency tree")
		.option("--json", "Output tree as JSON")
		.option("-g, --global", "Show global dependency tree")
		.option(
			"--dedupe",
			"Stop recursion under already-printed subtrees (terse, cargo-tree default style)",
		)
		.action(async (opts) => {
			await depsTreeCommand(process.cwd(), {
				global: opts.global,
				json: opts.json,
				dedupe: opts.dedupe,
			});
		});

	program
		.command("why <name>")
		.description(
			"Show which top-level dependency pulled in <name>\n\nWalks the resolved graph backwards from <name> to every reachable top-level dep declared in skilltree.yml. Mirrors `npm why`.",
		)
		.option("-t, --type <type>", "Disambiguate when <name> matches multiple entity types")
		.option("--json", "Output paths as JSON")
		.option("-g, --global", "Inspect the global lockfile")
		.action(async (name: string, opts) => {
			await whyCommand(name, {
				dir: process.cwd(),
				global: opts.global,
				type: opts.type,
				json: opts.json,
			});
		});

	const registry = program.command("registry").description("Registry management commands");

	registry
		.command("init")
		.description(
			"Seed popular community registries for skill discovery\n\nRelated:\n  init            — initialize a new skilltree project (run this first)\n  targets detect  — auto-discover installed coding agents on this machine",
		)
		.option("--skip-update", "Add registries without indexing")
		.action(async (opts) => {
			await registryInitCommand({ skipUpdate: opts.skipUpdate });
		});

	registry
		.command("add [url]")
		.description(
			"Register a git repo as a searchable registry\n\nThe URL can be passed positionally or via --repo (so muscle memory from `add` transfers).\n\nExamples:\n  skilltree registry add github.com/VoltAgent/awesome-agent-skills\n  skilltree registry add --repo github.com/trailofbits/skills --name security",
		)
		.option("-r, --repo <url>", "Git repository URL (alias for the positional <url>)")
		.option("--name <alias>", "Custom name for the registry")
		.action(async (url: string | undefined, opts) => {
			const resolvedUrl = resolveRegistryAddUrl(url, opts.repo);
			await registryAddCommand(resolvedUrl, { name: opts.name });
		});

	registry
		.command("remove <name>")
		.description("Remove a registered registry")
		.action(async (name: string) => {
			await registryRemoveCommand(name);
		});

	registry
		.command("list")
		.description("List all registered registries")
		.option("--json", "Output results as JSON")
		.action(async (opts) => {
			await registryListCommand(undefined, undefined, { json: opts.json });
		});

	registry
		.command("update [name]")
		.description("Fetch registry repos and rebuild search indexes")
		.option("--json", "Output results as JSON")
		.action(async (name: string | undefined, opts) => {
			await registryUpdateCommand(name, undefined, undefined, { json: opts.json });
		});

	registry
		.command("index")
		.description("Generate skilltree-index.yml for this repo")
		.option("--check", "Check if index is up to date (exit 1 if stale)")
		.action(async (opts) => {
			await indexCommand({ check: opts.check });
		});

	program
		.command("search <query>")
		.description("Search registries for skills, agents, and commands")
		.option("--registry <name>", "Search only one registry")
		.option("-t, --type <type>", "Filter by entity type (skill, agent, or command)")
		.option("--json", "Output results as JSON")
		.action(async (query: string, opts) => {
			await searchCommand(query, {
				registry: opts.registry,
				type: opts.type,
				json: opts.json,
			});
		});

	program
		.command("info <name>")
		.description("Show detailed information about a skill, agent, or command")
		.option("--json", "Output results as JSON")
		.action(async (name: string, opts) => {
			await infoCommand(name, { json: opts.json, dir: process.cwd() });
		});

	program
		.command("completion [shell]")
		.description("Output shell completion script (zsh or bash)")
		.option("--install", "Write the script to the conventional location instead of stdout")
		.action(async (shell?: string, opts?: { install?: boolean }) => {
			await completionCommand(shell, { install: opts?.install });
		});

	// Hidden subcommand backing dynamic shell completion. Emits one suggestion
	// per line on stdout. See `src/commands/_complete.ts` for the rules: never
	// throws, never prints diagnostics — must be safe to call on every <TAB>.
	program
		.command("_complete <kind>", { hidden: true })
		.description("(internal) Emit dynamic completion suggestions")
		.option("-g, --global", "Read from the global manifest")
		.action(async (kind: string, opts) => {
			await completeCommand(kind, { global: opts.global });
		});

	const targets = program.command("targets").description("Manage install targets (coding agents)");

	targets
		.command("list")
		.description("Show known agents with detected and configured status")
		.option("--json", "Output results as JSON")
		.option("-g, --global", "Show global targets")
		.action(async (opts) => {
			await targetsListCommand(process.cwd(), { global: opts.global, json: opts.json });
		});

	targets
		.command("add <target>")
		.description("Add an agent or path to install_targets")
		.option("-g, --global", "Add to global manifest")
		.action(async (target: string, opts) => {
			await targetsAddCommand(target, process.cwd(), { global: opts.global });
		});

	targets
		.command("remove <target>")
		.description("Remove an agent or path from install_targets")
		.option("-g, --global", "Remove from global manifest")
		.action(async (target: string, opts) => {
			await targetsRemoveCommand(target, process.cwd(), { global: opts.global });
		});

	targets
		.command("detect")
		.description(
			"Scan for installed agents and add missing ones\n\nRelated:\n  init            — initialize a new skilltree project (run this first)\n  registry init   — seed popular community registries to install skills from",
		)
		.option("-g, --global", "Detect for global manifest")
		.action(async (opts) => {
			await targetsDetectCommand(process.cwd(), { global: opts.global });
		});

	targets
		.command("migrate")
		.description("Convert dev_install_path to install_targets")
		.option("-g, --global", "Migrate global manifest")
		.action(async (opts) => {
			await targetsMigrateCommand(process.cwd(), { global: opts.global });
		});

	const cache = program.command("cache").description("Cache management commands");

	cache
		.command("clean")
		.description("Remove cached repositories")
		.option("--json", "Output results as JSON")
		.action(async (opts) => {
			await cacheCleanCommand({ json: opts.json });
		});

	return program;
}

// Auto-run only when invoked directly (not when imported by tests).
// `import.meta.main` is set by Bun for the entry script and the
// compiled-binary entry point; it's false during test runs that import
// this module via `import { buildProgram } from ...`.
if (import.meta.main) {
	buildProgram()
		.parseAsync()
		.catch((err: unknown) => {
			const message = err instanceof Error ? err.message : String(err);
			console.error(pc.red(`✘ ${message}`));
			process.exit(1);
		});
}
