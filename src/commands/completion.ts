/**
 * Shell completion generators for skilltree.
 *
 * Two halves:
 *  - Static structure (top-level commands, subcommands, flag names) is built
 *    from the `COMMANDS` table below. Drift between this table and `cli.ts`
 *    is caught by the freshness test in `tests/commands/completion.test.ts`.
 *  - Dynamic value completion (installed dep names, targets, agents) is
 *    delegated at <TAB>-time to the hidden `skilltree _complete <kind>`
 *    subcommand. The shell scripts emitted here include small helper
 *    functions that shell out to it. See `src/commands/_complete.ts`.
 *
 * If you add a command, subcommand, or flag to cli.ts, mirror it in
 * `COMMANDS` here. If you add a positional argument that should
 * tab-complete from runtime state, set `positionalComplete` on the entry.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { dim, pc, success } from "../core/ui.js";
import type { CompleteKind } from "./_complete.js";

interface FlagDef {
	long: string;
	short?: string;
	description: string;
	takesArg?: boolean;
	/**
	 * If set, the *value* of this flag tab-completes via the named
	 * `_complete` kind. Implies `takesArg: true`. Drives the zsh
	 * `:arg:helper` spec and the bash `case "$prev"` dispatch (Issue #22).
	 */
	valueComplete?: CompleteKind;
}

interface CmdDef {
	name: string;
	description: string;
	flags?: FlagDef[];
	subcommands?: CmdDef[];
	/** What the first positional argument should tab-complete to, if anything. */
	positionalComplete?: CompleteKind;
}

const COMMANDS: CmdDef[] = [
	{
		name: "init",
		description: "Initialize a new skilltree project",
		flags: [
			{ long: "--global", short: "-g", description: "Initialize global dependencies" },
			{ long: "--scan", description: "Scan repo for existing skills, agents, and commands" },
			{
				long: "--yes",
				short: "-y",
				description: "Include all discovered entries without prompting",
			},
		],
	},
	{
		name: "add",
		description: "Add a dependency",
		flags: [
			{ long: "--repo", short: "-r", description: "Git repository URL", takesArg: true },
			{ long: "--source", description: "Source alias", takesArg: true },
			{ long: "--path", short: "-p", description: "Path within the repository", takesArg: true },
			{ long: "--version", short: "-v", description: "Semver version constraint", takesArg: true },
			{ long: "--local", short: "-l", description: "Local filesystem path", takesArg: true },
			{ long: "--dev", short: "-D", description: "Add as dev dependency" },
			{
				long: "--type",
				short: "-t",
				description: "Entity type (skill, agent, or command)",
				takesArg: true,
				valueComplete: "types",
			},
			{
				long: "--registry",
				description: "Resolve from this registry",
				takesArg: true,
				valueComplete: "registries",
			},
			{ long: "--global", short: "-g", description: "Add to global dependencies" },
		],
	},
	{
		name: "install",
		description: "Resolve and install dependencies",
		flags: [
			{ long: "--prod", description: "Install production dependencies only" },
			{ long: "--frozen", description: "Use lockfile only" },
			{ long: "--force", short: "-f", description: "Overwrite locally modified files" },
			{ long: "--dry-run", short: "-n", description: "Show plan without installing" },
			{ long: "--install-path", description: "Override install directory", takesArg: true },
			{ long: "--global", short: "-g", description: "Install global dependencies" },
		],
	},
	{
		name: "update",
		description: "Update dependencies to latest versions",
		positionalComplete: "deps",
		flags: [
			{ long: "--dry-run", short: "-n", description: "Preview version bumps" },
			{ long: "--global", short: "-g", description: "Update global dependencies" },
		],
	},
	{
		name: "remove",
		description: "Remove a dependency",
		positionalComplete: "deps",
		flags: [
			{ long: "--force", short: "-f", description: "Skip confirmation" },
			{ long: "--keep-files", description: "Leave installed files in place" },
			{ long: "--global", short: "-g", description: "Remove from global dependencies" },
		],
	},
	{
		name: "verify",
		description: "Verify installed dependencies against lockfile",
		flags: [{ long: "--global", short: "-g", description: "Verify global dependencies" }],
	},
	{
		name: "check",
		description: "Lint the project's skilltree.yml for design-time issues",
		flags: [{ long: "--strict", description: "Exit 1 if any warnings are found" }],
	},
	{
		name: "list",
		description: "List installed dependencies",
		flags: [
			{ long: "--json", description: "Output results as JSON" },
			{ long: "--global", short: "-g", description: "List global dependencies" },
		],
	},
	{
		name: "scan",
		description: "Scan skills, agents, and commands for undeclared dependencies",
		flags: [
			{ long: "--check", description: "Exit 1 if undeclared deps found" },
			{ long: "--apply", description: "Auto-update frontmatter" },
			{ long: "--llm", description: "Use LLM for deep detection" },
			{ long: "--json", description: "Output results as JSON" },
		],
	},
	{
		name: "teach",
		description: "Install the skilltree skill to all detected coding agents",
		flags: [{ long: "--agent", description: "Install to a specific agent only", takesArg: true }],
	},
	{
		name: "search",
		description: "Search registries for skills, agents, and commands",
		flags: [
			{
				long: "--registry",
				description: "Search only one registry",
				takesArg: true,
				valueComplete: "registries",
			},
			{
				long: "--type",
				short: "-t",
				description: "Filter by entity type",
				takesArg: true,
				valueComplete: "types",
			},
			{ long: "--json", description: "Output results as JSON" },
		],
	},
	{
		name: "info",
		description: "Show detailed information about a skill, agent, or command",
		positionalComplete: "deps",
		flags: [{ long: "--json", description: "Output results as JSON" }],
	},
	{
		name: "vendor",
		description: "Copy all deps as real files for git commit",
		flags: [
			{ long: "--frozen", description: "Use lockfile only" },
			{ long: "--dry-run", short: "-n", description: "Show plan without making changes" },
		],
	},
	{
		name: "unvendor",
		description: "Exit vendor mode, restore normal installs",
		flags: [{ long: "--force", short: "-f", description: "Discard modified vendored files" }],
	},
	{
		name: "deps",
		description: "Dependency graph commands",
		subcommands: [
			{
				name: "tree",
				description: "Show dependency tree",
				flags: [{ long: "--global", short: "-g", description: "Show global dependency tree" }],
			},
		],
	},
	{
		name: "registry",
		description: "Registry management commands",
		subcommands: [
			{
				name: "init",
				description: "Seed popular community registries",
				flags: [{ long: "--skip-update", description: "Add registries without indexing" }],
			},
			{
				name: "add",
				description: "Register a git repo",
				flags: [{ long: "--name", description: "Custom name for the registry", takesArg: true }],
			},
			{ name: "remove", description: "Remove a registered registry" },
			{
				name: "list",
				description: "List all registered registries",
				flags: [{ long: "--json", description: "Output results as JSON" }],
			},
			{ name: "update", description: "Fetch repos and rebuild search indexes" },
			{
				name: "index",
				description: "Generate skilltree-index.yaml",
				flags: [{ long: "--check", description: "Check if index is up to date" }],
			},
		],
	},
	{
		name: "targets",
		description: "Manage install targets (coding agents)",
		subcommands: [
			{
				name: "list",
				description: "Show known agents with detected and configured status",
				flags: [{ long: "--global", short: "-g", description: "Show global targets" }],
			},
			{
				name: "add",
				description: "Add an agent or path to install_targets",
				positionalComplete: "agents",
				flags: [{ long: "--global", short: "-g", description: "Add to global manifest" }],
			},
			{
				name: "remove",
				description: "Remove an agent or path from install_targets",
				positionalComplete: "targets",
				flags: [{ long: "--global", short: "-g", description: "Remove from global manifest" }],
			},
			{
				name: "detect",
				description: "Scan for installed agents and add missing ones",
				flags: [{ long: "--global", short: "-g", description: "Detect for global manifest" }],
			},
			{
				name: "migrate",
				description: "Convert dev_install_path to install_targets",
				flags: [{ long: "--global", short: "-g", description: "Migrate global manifest" }],
			},
		],
	},
	{
		name: "cache",
		description: "Cache management commands",
		subcommands: [{ name: "clean", description: "Remove cached repositories" }],
	},
	{
		name: "completion",
		description: "Output shell completion script",
		flags: [{ long: "--install", description: "Write to the conventional path instead of stdout" }],
	},
];

// --- Shared helpers used by both shell generators ---------------------------

/**
 * Identity string for a (sub)command, used in the generated `--global`-aware
 * lists. Top-level: `"remove"`. Subcommand: `"targets:remove"`. The colon
 * separator is chosen because zsh's `case` patterns and bash's substring
 * match both treat it as an opaque character — no escaping needed.
 */
function commandPath(cmd: CmdDef, parent?: CmdDef): string {
	return parent ? `${parent.name}:${cmd.name}` : cmd.name;
}

/** True iff this command declares `--global` as one of its flags. */
function commandSupportsGlobal(cmd: CmdDef): boolean {
	return (cmd.flags ?? []).some((f) => f.long === "--global");
}

/**
 * Walk the COMMANDS table and collect identity strings for every command
 * that (a) has a `positionalComplete` and (b) accepts `--global`. Used by
 * the dynamic-completion helpers in both shells to decide whether to honor
 * a `--global` token they see on the line.
 *
 * Why this matters: `skilltree info <name>` has dynamic completion (deps)
 * but does NOT accept `--global`. If a user accidentally types
 * `skilltree info xxx --global`, we don't want completion to silently
 * switch to the global manifest — that would suggest names that have no
 * meaning in the local context. Scoping `--global` detection to only the
 * commands that declare it preserves user intent.
 */
function globalAwareCommandPaths(): string[] {
	const paths: string[] = [];
	for (const cmd of COMMANDS) {
		if (cmd.positionalComplete && commandSupportsGlobal(cmd)) {
			paths.push(commandPath(cmd));
		}
		for (const sub of cmd.subcommands ?? []) {
			if (sub.positionalComplete && commandSupportsGlobal(sub)) {
				paths.push(commandPath(sub, cmd));
			}
		}
	}
	return paths;
}

/**
 * Names of every top-level command that has subcommands. Used to teach the
 * `_skilltree_cmd_path` shell helper to *only* treat `$words[2]` as a
 * subcommand when `$words[1]` is one of these — otherwise a positional or
 * a flag in slot 2 (`skilltree remove --global …`) gets wrongly stitched
 * into a `parent:flag` identity that matches nothing.
 */
function parentCommandNames(): string[] {
	return COMMANDS.filter((c) => (c.subcommands?.length ?? 0) > 0).map((c) => c.name);
}

// --- Zsh ---------------------------------------------------------------------

/**
 * Per-flag arg spec. Always emits both forms when a short alias exists, so
 * `skilltree install -<TAB>` lists `-f -n -g` alongside `--force --dry-run
 * --global`. Mutex via `(a b)` prevents both forms appearing as further
 * suggestions once one has been typed.
 */
function zshFlagSpecs(flags: FlagDef[]): string[] {
	const specs: string[] = [];
	for (const f of flags) {
		const desc = escapeZsh(f.description);
		// `:arg:` with a trailing helper name (or empty) is the zsh
		// argument spec for "this flag takes one argument completed via
		// <helper>". Empty helper falls back to default file completion.
		const helper = f.valueComplete ? zshHelperName(f.valueComplete) : "";
		const argSuffix = f.takesArg || f.valueComplete ? `:arg:${helper}` : "";
		if (f.short) {
			specs.push(`'(${f.long} ${f.short})'{${f.long},${f.short}}'[${desc}]${argSuffix}'`);
		} else {
			specs.push(`'${f.long}[${desc}]${argSuffix}'`);
		}
	}
	return specs;
}

/**
 * Map a `positionalComplete` value to the zsh helper-function name we emit.
 * Single source of truth so the case-branch generator and the helper-emitter
 * can't drift.
 */
function zshHelperName(kind: CompleteKind): string {
	return `_skilltree_complete_${kind}`;
}

/**
 * Build the `_arguments` spec for a single positional value slot. We use
 * `:value:func` (single positional) rather than `*::value:func` (any number)
 * because every command with `positionalComplete` takes exactly one
 * argument; the multi-positional form caused completion to keep firing
 * after the first arg was already typed (cosmetic noise).
 */
function zshValueSpec(kind: CompleteKind): string {
	return `':value:${zshHelperName(kind)}'`;
}

function generateZshFlagCase(cmd: CmdDef): string {
	const args: string[] = cmd.flags ? zshFlagSpecs(cmd.flags) : [];
	if (cmd.positionalComplete) {
		args.push(zshValueSpec(cmd.positionalComplete));
	}
	if (args.length === 0) return "";
	return `                ${cmd.name}) _arguments ${args.join(" ")} ;;`;
}

function generateZshSubcommandCase(cmd: CmdDef): string {
	const subs = (cmd.subcommands ?? [])
		.map((s) => `'${s.name}:${escapeZsh(s.description)}'`)
		.join(" ");

	const subCases = (cmd.subcommands ?? [])
		.filter((s) => (s.flags?.length ?? 0) > 0 || s.positionalComplete)
		.map((s) => {
			const args: string[] = s.flags ? zshFlagSpecs(s.flags) : [];
			if (s.positionalComplete) {
				args.push(zshValueSpec(s.positionalComplete));
			}
			return `                        ${s.name}) _arguments ${args.join(" ")} ;;`;
		})
		.join("\n");

	let body = `                    local -a subcmds\n                    subcmds=(${subs})\n                    _describe '${cmd.name} command' subcmds`;

	if (subCases) {
		body = `                    case $words[2] in
${subCases}
                        *)
                            local -a subcmds
                            subcmds=(${subs})
                            _describe '${cmd.name} command' subcmds
                            ;;
                    esac`;
	}

	return `                ${cmd.name})
${body}
                    ;;`;
}

/** Emit the shared zsh helper functions that call back into `skilltree _complete`. */
function generateZshHelpers(): string {
	// `_skilltree_cmd_path` derives the same identity string used by
	// `globalAwareCommandPaths()` from the live $words array, so the
	// subsequent case-pattern match stays in sync with the generator.
	//
	// `_skilltree_global_flag` only honors `--global` for commands that
	// actually declare the flag — see `globalAwareCommandPaths()` for the
	// reasoning. The list is interpolated below at gen time.
	const awarePaths = globalAwareCommandPaths().join(" ");
	const parents = parentCommandNames().join("|");
	return `# Build a "parent:sub" identity if $words[1] is a known parent command,
# otherwise just $words[1]. Without the parent gate, "skilltree remove --global"
# would synthesize "remove:--global" — matching nothing, but worse than that
# it bypasses the awarePaths check below.
_skilltree_cmd_path() {
    local first="${"$"}{words[1]:-}" second="${"$"}{words[2]:-}"
    case "$first" in
        ${parents})
            if [[ -n "$second" && "$second" != -* ]]; then
                echo "$first:$second"
                return
            fi
            ;;
    esac
    echo "$first"
}

_skilltree_global_flag() {
    local cmd_path
    cmd_path=$(_skilltree_cmd_path)
    # Only commands that declare --global should switch scope.
    case " ${awarePaths} " in
        *" $cmd_path "*) ;;
        *) return ;;
    esac
    if (( ${"$"}{words[(I)--global]} > 0 || ${"$"}{words[(I)-g]} > 0 )); then
        echo "--global"
    fi
}

_skilltree_complete_deps() {
    local -a items
    items=(${"$"}{(f)"$(skilltree _complete deps $(_skilltree_global_flag) 2>/dev/null)"})
    _describe 'dep' items
}

_skilltree_complete_targets() {
    local -a items
    items=(${"$"}{(f)"$(skilltree _complete targets $(_skilltree_global_flag) 2>/dev/null)"})
    _describe 'target' items
}

_skilltree_complete_agents() {
    local -a items
    items=(${"$"}{(f)"$(skilltree _complete agents 2>/dev/null)"})
    _describe 'agent' items
}

_skilltree_complete_types() {
    local -a items
    items=(${"$"}{(f)"$(skilltree _complete types 2>/dev/null)"})
    _describe 'type' items
}

_skilltree_complete_registries() {
    local -a items
    items=(${"$"}{(f)"$(skilltree _complete registries 2>/dev/null)"})
    _describe 'registry' items
}`;
}

export function generateZshCompletion(): string {
	const topLevelCmds = COMMANDS.map((c) => `'${c.name}:${escapeZsh(c.description)}'`).join(
		"\n        ",
	);

	const caseBranches = COMMANDS.map((cmd) => {
		if (cmd.subcommands) {
			return generateZshSubcommandCase(cmd);
		}
		return generateZshFlagCase(cmd);
	})
		.filter(Boolean)
		.join("\n");

	return `#compdef skilltree
# Zsh completion for skilltree v${pkg.version}
# Install: skilltree completion --install
#     or:  eval "$(skilltree completion zsh)"

${generateZshHelpers()}

_skilltree() {
    local -a commands
    local curcontext="$curcontext" state

    commands=(
        ${topLevelCmds}
    )

    _arguments -C \\
        '--version[Show version]' \\
        '-V[Show version]' \\
        '--help[Show help]' \\
        '-h[Show help]' \\
        '1:command:->command' \\
        '*::args:->args'

    case $state in
        command)
            _describe 'skilltree command' commands
            ;;
        args)
            case $words[1] in
${caseBranches}
            esac
            ;;
    esac
}

compdef _skilltree skilltree
`;
}

/**
 * Escape a description string for safe interpolation into a zsh
 * `_arguments` spec wrapped in single quotes (e.g. `'flag[desc]'`).
 *
 * Backslash MUST be escaped first so the subsequent `\[` / `\]` injections
 * don't combine with a pre-existing `\` from the input to form `\\[` (which
 * zsh reads as literal-backslash + description-group-start, breaking the
 * spec). Same logic for `'` — the `'\''` sequence must not double-interpret
 * an upstream backslash.
 *
 * Exported for unit testing.
 */
export function escapeZsh(s: string): string {
	return s
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "'\\''")
		.replace(/\[/g, "\\[")
		.replace(/\]/g, "\\]");
}

// --- Bash --------------------------------------------------------------------

/**
 * Build the space-separated list of all flag tokens (long + short) we want
 * `compgen` to suggest after a command. The helper is included verbatim in
 * the generated script.
 */
function bashFlagWords(flags: FlagDef[]): string {
	const words: string[] = [];
	for (const f of flags) {
		words.push(f.long);
		if (f.short) words.push(f.short);
	}
	return words.join(" ");
}

/**
 * Build a `case "$prev" in` snippet that completes flag *values* via
 * `_skilltree_dyn <kind>` when the previous word is one of the flags
 * declaring `valueComplete`. Each case-arm returns immediately so the
 * surrounding flag/positional logic doesn't run on the value slot.
 *
 * Returns an empty string if the command has no value-completed flags.
 *
 * Indentation is controlled by `indent` so subcommand emitters and
 * top-level emitters can both reuse this helper without misaligning.
 */
function bashFlagValueDispatch(flags: FlagDef[] | undefined, indent: string): string {
	const valueFlags = (flags ?? []).filter((f) => f.valueComplete);
	if (valueFlags.length === 0) return "";
	const arms = valueFlags
		.map((f) => {
			const tokens = f.short ? `${f.long}|${f.short}` : f.long;
			return `${indent}    ${tokens}) COMPREPLY=($(compgen -W "$(_skilltree_dyn ${f.valueComplete})" -- "$cur")); return ;;`;
		})
		.join("\n");
	return `${indent}case "$prev" in\n${arms}\n${indent}esac`;
}

function bashCmdBranch(cmd: CmdDef): string {
	const flagWords = cmd.flags?.length ? bashFlagWords(cmd.flags) : "";
	const completeKind = cmd.positionalComplete;
	const valueDispatch = bashFlagValueDispatch(cmd.flags, "            ");

	if (!flagWords && !completeKind && !valueDispatch) return "";

	// Compose body: any flag-value dispatch runs first; then the
	// flag-vs-positional split (if both apply); else just one of them.
	const lines: string[] = [];
	if (valueDispatch) lines.push(valueDispatch);
	if (completeKind && flagWords) {
		// Mix of flags and a value-completing positional. If the current
		// word starts with `-`, suggest flags; otherwise suggest values.
		lines.push(`            if [[ "$cur" == -* ]]; then`);
		lines.push(`                COMPREPLY=($(compgen -W "${flagWords}" -- "$cur"))`);
		lines.push(`            else`);
		lines.push(
			`                COMPREPLY=($(compgen -W "$(_skilltree_dyn ${completeKind})" -- "$cur"))`,
		);
		lines.push(`            fi`);
	} else if (completeKind) {
		lines.push(
			`            COMPREPLY=($(compgen -W "$(_skilltree_dyn ${completeKind})" -- "$cur"))`,
		);
	} else if (flagWords) {
		lines.push(`            COMPREPLY=($(compgen -W "${flagWords}" -- "$cur"))`);
	}

	// Single-line form preserves the original output shape when there's
	// no value-dispatch — keeps existing freshness tests / regex anchors
	// stable for the simple case (e.g. `remove)`).
	if (!valueDispatch && lines.length === 1) {
		return `        ${cmd.name}) ${lines[0]?.trim() ?? ""} ;;`;
	}

	return `        ${cmd.name})\n${lines.join("\n")}\n            ;;`;
}

export function generateBashCompletion(): string {
	const topLevelNames = COMMANDS.map((c) => c.name).join(" ");

	const caseBranches = COMMANDS.map((cmd) => {
		if (cmd.subcommands) {
			const subNames = cmd.subcommands.map((s) => s.name).join(" ");
			const subCases = cmd.subcommands
				.filter((s) => (s.flags?.length ?? 0) > 0 || s.positionalComplete)
				.map((s) => {
					const flagWords = s.flags?.length ? bashFlagWords(s.flags) : "";
					if (s.positionalComplete && flagWords) {
						return `            ${s.name})
                if [[ "$cur" == -* ]]; then
                    COMPREPLY=($(compgen -W "${flagWords}" -- "$cur"))
                else
                    COMPREPLY=($(compgen -W "$(_skilltree_dyn ${s.positionalComplete})" -- "$cur"))
                fi
                ;;`;
					}
					if (s.positionalComplete) {
						return `            ${s.name}) COMPREPLY=($(compgen -W "$(_skilltree_dyn ${s.positionalComplete})" -- "$cur")) ;;`;
					}
					return `            ${s.name}) COMPREPLY=($(compgen -W "${flagWords}" -- "$cur")) ;;`;
				})
				.join("\n");

			return `        ${cmd.name})
            if [[ $COMP_CWORD -eq 2 ]]; then
                COMPREPLY=($(compgen -W "${subNames}" -- "$cur"))
            else
                local subcmd="\${COMP_WORDS[2]}"
                case "$subcmd" in
${subCases}
                esac
            fi
            ;;`;
		}
		return bashCmdBranch(cmd);
	})
		.filter(Boolean)
		.join("\n");

	const awarePaths = globalAwareCommandPaths().join(" ");
	const parents = parentCommandNames().join("|");
	return `# Bash completion for skilltree v${pkg.version}
# Install: skilltree completion --install
#     or:  eval "$(skilltree completion bash)"

# Derive the same identity string used by the gen-time globalAwareCommandPaths()
# from the live COMP_WORDS array, so the case-pattern below can match. Only
# stitch "parent:sub" when COMP_WORDS[1] is a known parent command — otherwise
# "skilltree remove --global" would build "remove:--global" and bypass scope.
_skilltree_cmd_path() {
    local first="\${COMP_WORDS[1]:-}" second="\${COMP_WORDS[2]:-}"
    case "$first" in
        ${parents})
            if [[ -n "$second" && "$second" != -* ]]; then
                echo "$first:$second"
                return
            fi
            ;;
    esac
    echo "$first"
}

# Detect --global / -g on the line — but ONLY for commands that actually
# accept the flag. Without this scope check, "skilltree info xxx --global"
# would (wrongly) flip dynamic completion into global-manifest mode even
# though "info" does not declare --global. The list is generated at build
# time from the COMMANDS table; see globalAwareCommandPaths() in
# completion.ts.
_skilltree_global_flag() {
    local cmd_path
    cmd_path=$(_skilltree_cmd_path)
    case " ${awarePaths} " in
        *" $cmd_path "*) ;;
        *) return ;;
    esac
    local w
    for w in "\${COMP_WORDS[@]}"; do
        if [[ "$w" == "--global" || "$w" == "-g" ]]; then
            echo "--global"
            return
        fi
    done
}

# Shell out to \`skilltree _complete <kind>\` with the right scope. Errors
# are silenced so a broken manifest can't pollute the shell.
_skilltree_dyn() {
    skilltree _complete "$1" $(_skilltree_global_flag) 2>/dev/null
}

_skilltree() {
    local cur prev cmd
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    cmd="\${COMP_WORDS[1]}"

    if [[ $COMP_CWORD -eq 1 ]]; then
        COMPREPLY=($(compgen -W "${topLevelNames} --version --help" -- "$cur"))
        return
    fi

    case "$cmd" in
${caseBranches}
    esac
}

complete -F _skilltree skilltree
`;
}

// --- Install -----------------------------------------------------------------

/**
 * Where to write the completion script for each shell. Picked to be picked
 * up automatically by the shell's standard completion-loading mechanism.
 *
 * - zsh: a writable dir we put on `$fpath`. We use `~/.zfunc` because it's
 *   the de-facto convention; the user adds it to fpath in their `.zshrc`.
 * - bash: the XDG bash-completion lookup path (`~/.local/share/bash-completion/completions/<name>`).
 *   System bash-completion picks this up automatically without any rc edit.
 */
function getInstallPath(shell: "zsh" | "bash", home: string): string {
	if (shell === "zsh") return join(home, ".zfunc", "_skilltree");
	return join(home, ".local", "share", "bash-completion", "completions", "skilltree");
}

/**
 * Detect the user's shell from the SHELL env var. Returns null if it can't
 * confidently match; callers should fall back to asking the user.
 */
function detectShell(env: NodeJS.ProcessEnv = process.env): "zsh" | "bash" | null {
	const shell = env.SHELL ?? "";
	if (shell.endsWith("/zsh") || shell === "zsh") return "zsh";
	if (shell.endsWith("/bash") || shell === "bash") return "bash";
	return null;
}

export interface InstallCompletionOptions {
	homeDir?: string; // override $HOME (testing)
	env?: NodeJS.ProcessEnv; // override process.env (testing)
}

export interface InstallCompletionResult {
	shell: "zsh" | "bash";
	path: string;
}

/**
 * Write the completion script to the right place for `shell`. Returns the
 * detected shell and the absolute path written so callers don't have to
 * sniff the path to figure out which shell-specific instructions to print.
 * If `shell` is omitted, infer from `$SHELL`.
 *
 * `homeDir` resolution: we prefer the explicit caller override, then fall
 * back to `os.homedir()` (which goes through the OS, robust to empty
 * `$HOME`). `env.HOME` is only consulted when the caller passes a custom
 * `env` (testing) AND that `env.HOME` is non-empty — an empty-string `HOME`
 * is treated as "unset" per the project's presence-check doctrine, so we
 * don't accidentally write to `/.zfunc/_skilltree`.
 */
export async function installCompletion(
	shell: string | undefined,
	opts: InstallCompletionOptions = {},
): Promise<InstallCompletionResult> {
	const env = opts.env ?? process.env;
	const envHome = env.HOME && env.HOME.length > 0 ? env.HOME : undefined;
	const home = opts.homeDir ?? envHome ?? homedir();

	const target = shell ?? detectShell(env);
	if (target !== "zsh" && target !== "bash") {
		throw new Error(
			"Could not detect shell — pass one explicitly: `skilltree completion zsh --install` or `... bash --install`.",
		);
	}

	const script = target === "zsh" ? generateZshCompletion() : generateBashCompletion();
	const path = getInstallPath(target, home);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, script, "utf-8");
	return { shell: target, path };
}

/**
 * CLI handler for `skilltree completion [shell] [--install]`.
 *
 * - No `--install`: print the script to stdout (existing behavior — keeps
 *   `skilltree completion zsh > somewhere` scripts working).
 * - With `--install`: write to the conventional path for the shell and
 *   print follow-up instructions.
 */
export async function completionCommand(
	shell?: string,
	opts: { install?: boolean } & InstallCompletionOptions = {},
): Promise<void> {
	if (opts.install) {
		const { shell: target, path } = await installCompletion(shell, opts);
		success(`Installed ${target} completion to ${pc.cyan(path)}`);
		if (target === "zsh") {
			console.log("");
			console.log(dim("If completion isn't picked up, add to your ~/.zshrc:"));
			console.log(pc.cyan("  fpath=(~/.zfunc $fpath)"));
			console.log(pc.cyan("  autoload -Uz compinit && compinit"));
		} else {
			console.log("");
			console.log(dim("Open a new shell to activate (bash-completion picks it up automatically)."));
		}
		return;
	}

	const target = shell ?? "zsh";
	switch (target) {
		case "zsh":
			console.log(generateZshCompletion());
			break;
		case "bash":
			console.log(generateBashCompletion());
			break;
		default:
			throw new Error(`Unsupported shell: "${target}". Use "zsh" or "bash".`);
	}
}
