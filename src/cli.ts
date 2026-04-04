#!/usr/bin/env bun
import { Command } from "commander";
import pkg from "../package.json";
import { addCommand } from "./commands/add.js";
import { cacheCleanCommand } from "./commands/cache.js";
import { completionCommand } from "./commands/completion.js";
import { depsTreeCommand } from "./commands/deps.js";
import { indexCommand } from "./commands/index-cmd.js";
import { infoCommand } from "./commands/info.js";
import { initCommand } from "./commands/init.js";
import { installCommand } from "./commands/install.js";
import { listCommand } from "./commands/list.js";
import {
	registryAddCommand,
	registryInitCommand,
	registryListCommand,
	registryRemoveCommand,
	registryUpdateCommand,
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
import { pc } from "./core/ui.js";

const program = new Command();

program
	.name("skilltree")
	.description("Dependency manager for AI agent skills")
	.version(pkg.version)
	.enablePositionalOptions()
	.passThroughOptions();

program
	.command("init")
	.description("Initialize a new skilltree project")
	.option("-g, --global", "Initialize global dependencies")
	.action(async (opts) => {
		await initCommand(process.cwd(), { global: opts.global });
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
	.option("-t, --type <type>", "Entity type (skill or agent)")
	.option("--registry <name>", "Resolve from this registry (when no --repo)")
	.option("-g, --global", "Add to global dependencies")
	.action(async (name: string, opts) => {
		await addCommand(name, opts, process.cwd());
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
	.command("remove <name>")
	.description("Remove a dependency")
	.option("-f, --force", "Skip confirmation")
	.option("--keep-files", "Leave installed files in place")
	.option("-g, --global", "Remove from global dependencies")
	.action(async (name: string, opts) => {
		await removeCommand(name, process.cwd(), {
			force: opts.force,
			keepFiles: opts.keepFiles,
			global: opts.global,
		});
	});

program
	.command("verify")
	.description("Verify installed dependencies against lockfile")
	.option("-g, --global", "Verify global dependencies")
	.action(async (opts) => {
		await verifyCommand(process.cwd(), { global: opts.global });
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
	.command("scan <paths...>")
	.description("Scan skills for undeclared dependencies")
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
	.command("teach [target]")
	.description("Install the skilltree skill globally so Claude Code knows how to use it")
	.action(async (target?: string) => {
		await teachCommand(target);
	});

// Vendor commands
program
	.command("vendor")
	.description("Copy all deps as real files for git commit (distribution mode)")
	.option("--frozen", "Use lockfile only, error if out of sync")
	.option("-n, --dry-run", "Show plan without making changes")
	.action(async (opts) => {
		await vendorCommand(process.cwd(), {
			frozen: opts.frozen,
			dryRun: opts.dryRun,
		});
	});

program
	.command("unvendor")
	.description("Exit vendor mode, restore normal symlinked installs")
	.option("-f, --force", "Discard modified vendored files")
	.action(async (opts) => {
		await unvendorCommand(process.cwd(), { force: opts.force });
	});

const deps = program.command("deps").description("Dependency graph commands");

deps
	.command("tree")
	.description("Show dependency tree")
	.option("-g, --global", "Show global dependency tree")
	.action(async (opts) => {
		await depsTreeCommand(process.cwd(), { global: opts.global });
	});

const registry = program.command("registry").description("Registry management commands");

registry
	.command("init")
	.description("Seed popular community registries for skill discovery")
	.option("--skip-update", "Add registries without indexing")
	.action(async (opts) => {
		await registryInitCommand({ skipUpdate: opts.skipUpdate });
	});

registry
	.command("add <url>")
	.description(
		"Register a git repo as a searchable registry\n\nExamples:\n  skilltree registry add github.com/VoltAgent/awesome-agent-skills\n  skilltree registry add github.com/trailofbits/skills --name security",
	)
	.option("--name <alias>", "Custom name for the registry")
	.action(async (url: string, opts) => {
		await registryAddCommand(url, { name: opts.name });
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
	.action(async (name?: string) => {
		await registryUpdateCommand(name);
	});

registry
	.command("index")
	.description("Generate skillkit-index.yaml for this repo")
	.option("--check", "Check if index is up to date (exit 1 if stale)")
	.action(async (opts) => {
		await indexCommand({ check: opts.check });
	});

program
	.command("search <query>")
	.description("Search registries for skills and agents")
	.option("--registry <name>", "Search only one registry")
	.option("-t, --type <type>", "Filter by entity type (skill or agent)")
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
	.description("Show detailed information about a skill or agent")
	.option("--json", "Output results as JSON")
	.action(async (name: string, opts) => {
		await infoCommand(name, { json: opts.json });
	});

program
	.command("completion [shell]")
	.description("Output shell completion script (zsh or bash)")
	.action(async (shell?: string) => {
		await completionCommand(shell);
	});

const targets = program.command("targets").description("Manage install targets (coding agents)");

targets
	.command("list")
	.description("Show known agents with detected and configured status")
	.action(async () => {
		await targetsListCommand(process.cwd());
	});

targets
	.command("add <target>")
	.description("Add an agent or path to install_targets")
	.action(async (target: string) => {
		await targetsAddCommand(target, process.cwd());
	});

targets
	.command("remove <target>")
	.description("Remove an agent or path from install_targets")
	.action(async (target: string) => {
		await targetsRemoveCommand(target, process.cwd());
	});

targets
	.command("detect")
	.description("Scan for installed agents and add missing ones")
	.action(async () => {
		await targetsDetectCommand(process.cwd());
	});

targets
	.command("migrate")
	.description("Convert dev_install_path to install_targets")
	.action(async () => {
		await targetsMigrateCommand(process.cwd());
	});

const cache = program.command("cache").description("Cache management commands");

cache
	.command("clean")
	.description("Remove cached repositories")
	.action(async () => {
		await cacheCleanCommand();
	});

// Global error handler: print clean error messages, no stack traces
program.parseAsync().catch((err: unknown) => {
	const message = err instanceof Error ? err.message : String(err);
	console.error(pc.red(`✘ ${message}`));
	process.exit(1);
});
