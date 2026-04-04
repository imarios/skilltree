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

# --- Scene 1: Init a new project ---

Type "# 1. Initialize a new project"
Enter
Sleep 500ms

Type "cd $(mktemp -d) && skilltree init"
Enter
Sleep 1.5s

# --- Scene 2: Add skills from a git repo ---

Type ""
Enter
Type "# 2. Add skills from any git repo (semver pinned)"
Enter
Sleep 500ms

Type "skilltree add typescript-coding \"
Enter
Type "  --repo github.com/imarios/open-vibes --path skills/typescript-coding --version '^1.0.0'"
Enter
Sleep 3s

Type "skilltree add general-coding \"
Enter
Type "  --repo github.com/imarios/open-vibes --path skills/general-coding --version '^1.0.0'"
Enter
Sleep 3s

# --- Scene 3: Install with resolution ---

Type ""
Enter
Type "# 3. Resolve dependencies and install (creates lockfile)"
Enter
Sleep 500ms

Type "skilltree install"
Enter
Sleep 4s

# --- Scene 4: Show what's installed ---

Type ""
Enter
Type "# 4. See what's installed"
Enter
Sleep 500ms

Type "skilltree list"
Enter
Sleep 2s

# --- Scene 5: Verify integrity ---

Type ""
Enter
Type "# 5. Verify installed files match lockfile"
Enter
Sleep 500ms

Type "skilltree verify"
Enter
Sleep 2s

Type ""
Enter
Type "# Skills installed to .claude/ — ready for Claude Code"
Enter
Sleep 3s
