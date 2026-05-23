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

# --- Hidden setup: clean HOME so registries start empty.
# We also pre-run `skilltree teach` to mirror a returning user's
# state — the bundled skilltree skill is a one-time global install,
# not something `skilltree install` (re)does per project. Without
# this, Scene 8's doctor would warn about a missing skill that a
# real user wouldn't actually be missing.

Hide
Type "export DEMO_HOME=$(mktemp -d)"
Enter
Type "mkdir -p $DEMO_HOME/.claude $DEMO_HOME/.cursor"
Enter
Type "export HOME=$DEMO_HOME"
Enter
Type "skilltree teach >/dev/null 2>&1"
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

# --- Scene 7: Show install targets ---

Type ""
Enter
Type "# 7. Skills installed to every detected agent"
Enter
Sleep 500ms

Type "skilltree targets list"
Enter
Sleep 2s

# --- Scene 8: Doctor — preflight health check ---

Type ""
Enter
Type "# 8. Doctor — schema, lockfile, targets, gitignore, registries, frontmatter"
Enter
Sleep 500ms

Type "skilltree doctor"
Enter
Sleep 3s

# --- Scene 9: List installed deps ---

Type ""
Enter
Type "# 9. List installed deps with versions + sources"
Enter
Sleep 500ms

Type "skilltree list"
Enter
Sleep 2s

# --- Outro ---

Type ""
Enter
Type "# Added 1 skill, got 2 — works across Claude Code, Cursor, Codex, and more"
Enter
Sleep 3s

# Bottom padding — the player's play-button overlay sits at the bottom-center
# of the final frame and obscures the last 2-3 lines. Push the real content
# up with a few quiet blank prompts so the closing message stays readable.
Type ""
Enter
Type ""
Enter
Type ""
Enter
Sleep 1.5s
