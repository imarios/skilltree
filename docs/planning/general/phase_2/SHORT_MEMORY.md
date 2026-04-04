# Short Memory: Phase 2 — End-to-End Tests

## Helper pattern
- `createTestRepo(baseDir, repoName, skills[], tagVersion?)` → creates git repo with skills
- `createLocalSkill(baseDir, name, deps?)` → creates SKILL.md in directory
- Need bare clone for remote deps: `simpleGit().clone(repoDir, bareDir, ["--bare"])`
- Use `file://{bareDir}` as repo URL in manifest

## Key APIs
- `installCommand(dir, options)` — options: prod, frozen, force, dryRun, installPath
- `updateCommand(dir, name?, dryRun?)` — name optional, dryRun optional
- `removeCommand(name, dir, options)` — options: force, keepFiles
- `initCommand(dir)` / `addCommand(name, opts, dir)` / `verifyCommand(dir)`

## Verification points
- Files exist at `.claude/skills/{name}/SKILL.md` or `.claude/agents/{name}.md`
- Symlinks vs copies: `lstat().isSymbolicLink()`
- Lockfile: parseLockfile → check packages entries
- Integrity: present for remote/copied, absent for symlinked local
