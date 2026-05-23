# Phase 1 — Detailed Plan

## Security pre-review

- **Path traversal**: paths are resolved through `resolveGlobalTarget(agent)` (existing, vetted). We append the literal `"skills/skilltree/SKILL.md"` — no user input flows into the join. Safe.
- **Filesystem access**: read-only `stat` + `readFile`. No writes. Matches doctor's read-only invariant.
- **YAML injection in version stamp**: the value being injected is `package.json`'s `version` — controlled by the maintainer, not the user. Quoted as a JSON string (`version: "x.y.z"`). Safe.
- **Network**: none.

## Phase-specific DoD

- Code-only change (no DB, no infra, no containers, no API surface change).
- Verification: `bun test` green; manual smoke `bun run dev -- doctor` shows new row.

## Implementation notes

### `injectSkillVersion(text, version)`

Operates on the raw SKILL.md text. Algorithm:
1. Locate the leading `---\n…\n---` block via the same approach as `extractFrontmatterYaml` in `frontmatter.ts` (don't reuse that helper — it returns sanitized YAML; we need string-level manipulation that preserves the rest of the file byte-for-byte).
2. Inside the block, if a `version:` line exists, replace its value; else insert `version: "<v>"` immediately after the `name:` line (falling back to start of block if there's no `name`).
3. Return the rebuilt full text.
4. If no frontmatter block exists, return the input unchanged (defensive — should never happen for the bundled SKILL.md).

### `checkBundledSkill(homeDir?)` flow

```
const agents = await detectInstalledAgents(homeDir);
if (agents.length === 0) return { name: "bundled-skill", status: "skip",
                                   detail: "no coding agents detected" };

const cliVersion = pkg.version;  // from package.json
const perAgent = await Promise.all(agents.map(async (a) => {
  const skillPath = join(resolveGlobalTarget(a), "skills", "skilltree", "SKILL.md");
  try {
    const text = await readFile(skillPath, "utf-8");
    const fm = parseFrontmatter(text);
    const installedVer = fm?.version;
    if (!installedVer) return { agent: a, kind: "no-version" };
    if (semver.lt(installedVer, cliVersion)) return { agent: a, kind: "stale", installedVer };
    return { agent: a, kind: "current", installedVer };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { agent: a, kind: "missing" };
    return { agent: a, kind: "error", message: String(e) };
  }
}));
```

Aggregate to one `CheckResult`:
- all `current` → `pass`
- any `missing` / `stale` / `no-version` → `warn`, detail enumerates per-agent state via `getAgentLabel`
- any `error` (non-ENOENT readFile failure) → contributes to `warn` with message
- fix string: `Run \`skilltree teach\` to install/update`

### Doctor wiring

- Add `homeDir?: string` to `DoctorOptions`.
- Insert `checks.push(await checkBundledSkill(opts.homeDir))` near the end of `runDoctor`, after `checkFrontmatter`.

### Frontmatter parser

Trivial: read `parsed.version` if string, store on result. Already tested implicitly by the lint path; add a direct test in `tests/core/frontmatter.test.ts`.
