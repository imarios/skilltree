# skilltree demo — Dependency manager for AI agent skills
# Run: vhs demo/demo.tape

Output demo/demo.gif

Set Shell "bash"
Set Theme "Catppuccin Mocha"
Set FontFamily "Menlo"
Set FontSize 14
Set Width 1200
Set Height 600
Set LetterSpacing 0
Set Padding 20
Set TypingSpeed 35ms

# --- Hidden setup: clean HOME so registries start empty ---

Hide
Type "export DEMO_HOME=$(mktemp -d)"
Enter
Type "mkdir -p $DEMO_HOME/.claude $DEMO_HOME/.codex"
Enter
Type "export HOME=$DEMO_HOME"
Enter
Type "cd $(mktemp -d)"
Enter
Sleep 500ms
Show

# --- Scene 1: Init a new project ---

Type "# 1. Initialize a new project"
Enter
Sleep 500ms

Type "skilltree init"
Enter
Sleep 1.5s

# --- Scene 2: Add a git repo as a registry ---

Type ""
Enter
Type "# 2. Add a git repo as a skill registry"
Enter
Sleep 500ms

Type "skilltree registry add github.com/imarios/open-vibes"
Enter
Sleep 4s

# --- Scene 3: Search by keyword ---

Type ""
Enter
Type "# 3. Search the registry"
Enter
Sleep 500ms

Type "skilltree search coding"
Enter
Sleep 3s

# --- Scene 4: Add by name (no --repo boilerplate) ---

Type ""
Enter
Type "# 4. Add by name — repo + path resolved from registry"
Enter
Sleep 500ms

Type "skilltree add frontend-coding"
Enter
Sleep 3s

# --- Scene 5: Install with transitive dependency resolution ---

Type ""
Enter
Type "# 5. Install — resolves transitive deps, creates lockfile"
Enter
Sleep 500ms

Type "skilltree install"
Enter
Sleep 5s

# --- Scene 6: Show the dependency tree ---

Type ""
Enter
Type "# 6. Dependency tree (frontend-coding pulled in typescript-coding)"
Enter
Sleep 500ms

Type "skilltree deps tree"
Enter
Sleep 2s

# --- Scene 7: Show installed files ---

Type ""
Enter
Type "# 7. Skills installed to every detected agent"
Enter
Sleep 500ms

Type "ls .claude/skills/ .codex/skills/"
Enter
Sleep 2s

# --- Outro ---

Type ""
Enter
Type "# Added 1 skill, got 2 — works across Claude Code, Codex, and more"
Enter
Sleep 3s
