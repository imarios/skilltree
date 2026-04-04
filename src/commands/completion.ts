/**
 * Shell completion generators for skilltree.
 *
 * These build completion scripts from the command/flag definitions below.
 * The freshness test in tests/commands/completion.test.ts verifies that
 * every command and flag from cli.ts appears in the generated output.
 * If you add a command or flag to cli.ts, add it here too — the test will
 * catch it if you forget.
 */

interface CmdDef {
	name: string;
	description: string;
	flags?: Array<{ long: string; short?: string; description: string; takesArg?: boolean }>;
	subcommands?: CmdDef[];
}

const COMMANDS: CmdDef[] = [
	{
		name: "init",
		description: "Initialize a new skilltree project",
		flags: [{ long: "--global", short: "-g", description: "Initialize global dependencies" }],
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
			{ long: "--type", short: "-t", description: "Entity type (skill or agent)", takesArg: true },
			{ long: "--registry", description: "Resolve from this registry", takesArg: true },
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
		flags: [
			{ long: "--dry-run", short: "-n", description: "Preview version bumps" },
			{ long: "--global", short: "-g", description: "Update global dependencies" },
		],
	},
	{
		name: "remove",
		description: "Remove a dependency",
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
		name: "list",
		description: "List installed dependencies",
		flags: [
			{ long: "--json", description: "Output results as JSON" },
			{ long: "--global", short: "-g", description: "List global dependencies" },
		],
	},
	{
		name: "scan",
		description: "Scan skills for undeclared dependencies",
		flags: [
			{ long: "--check", description: "Exit 1 if undeclared deps found" },
			{ long: "--apply", description: "Auto-update frontmatter" },
			{ long: "--llm", description: "Use LLM for deep detection" },
			{ long: "--json", description: "Output results as JSON" },
		],
	},
	{ name: "teach", description: "Install the skilltree skill globally" },
	{
		name: "search",
		description: "Search registries for skills and agents",
		flags: [
			{ long: "--registry", description: "Search only one registry", takesArg: true },
			{ long: "--type", short: "-t", description: "Filter by entity type", takesArg: true },
			{ long: "--json", description: "Output results as JSON" },
		],
	},
	{
		name: "info",
		description: "Show detailed information about a skill or agent",
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
		name: "cache",
		description: "Cache management commands",
		subcommands: [{ name: "clean", description: "Remove cached repositories" }],
	},
	{ name: "completion", description: "Output shell completion script" },
];

export function generateZshCompletion(): string {
	const topLevelCmds = COMMANDS.map((c) => `'${c.name}:${escapeZsh(c.description)}'`).join(
		"\n        ",
	);

	const caseBranches = COMMANDS.map((cmd) => {
		if (cmd.subcommands) {
			return generateZshSubcommandCase(cmd);
		}
		if (cmd.flags?.length) {
			return generateZshFlagCase(cmd.name, cmd.flags);
		}
		return "";
	})
		.filter(Boolean)
		.join("\n");

	return `#compdef skilltree
# Zsh completion for skilltree v0.4.0
# Install: eval "$(skilltree completion zsh)"

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

function generateZshSubcommandCase(cmd: CmdDef): string {
	const subs = (cmd.subcommands ?? [])
		.map((s) => `'${s.name}:${escapeZsh(s.description)}'`)
		.join(" ");

	const subCases = (cmd.subcommands ?? [])
		.filter((s) => s.flags?.length)
		.map((s) => {
			const flags = (s.flags ?? [])
				.map((f) => `'${f.long}[${escapeZsh(f.description)}]'`)
				.join(" ");
			return `                        ${s.name}) _arguments ${flags} ;;`;
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

function generateZshFlagCase(name: string, flags: NonNullable<CmdDef["flags"]>): string {
	const flagArgs = flags.map((f) => `'${f.long}[${escapeZsh(f.description)}]'`).join(" ");
	return `                ${name}) _arguments ${flagArgs} ;;`;
}

function escapeZsh(s: string): string {
	return s.replace(/'/g, "'\\''").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

export function generateBashCompletion(): string {
	const topLevelNames = COMMANDS.map((c) => c.name).join(" ");

	const caseBranches = COMMANDS.map((cmd) => {
		if (cmd.subcommands) {
			const subNames = cmd.subcommands.map((s) => s.name).join(" ");
			const subCases = cmd.subcommands
				.filter((s) => s.flags?.length)
				.map((s) => {
					const flagNames = (s.flags ?? []).map((f) => f.long).join(" ");
					return `            ${s.name}) COMPREPLY=($(compgen -W "${flagNames}" -- "$cur")) ;;`;
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
		if (cmd.flags?.length) {
			const flagNames = cmd.flags.map((f) => f.long).join(" ");
			return `        ${cmd.name}) COMPREPLY=($(compgen -W "${flagNames}" -- "$cur")) ;;`;
		}
		return "";
	})
		.filter(Boolean)
		.join("\n");

	return `# Bash completion for skilltree v0.4.0
# Install: eval "$(skilltree completion bash)"

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

/**
 * CLI handler for `skilltree completion <shell>`
 */
export async function completionCommand(shell?: string): Promise<void> {
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
