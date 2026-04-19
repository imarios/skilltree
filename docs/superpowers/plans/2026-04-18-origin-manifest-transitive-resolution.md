# Origin-Manifest Transitive Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend transitive dependency resolution to consult the origin repo's `skilltree.yaml` before falling back to the conventional path probe, so repos that don't follow the `skills/<name>/` convention can still be auto-resolved transitively.

**Architecture:** Add one helper, `tryResolveFromOriginManifest`, in `src/core/graph.ts` that runs between `tryResolveFromLocalSource` and `tryResolveFromSameRepo`. The helper fetches `skilltree.yaml` at the parent's git ref, parses it, looks up the transitive dep name in `dependencies` (never `dev-dependencies`), and synthesizes a remote dep pointing at the origin repo's corresponding path.

**Tech Stack:** TypeScript, Bun test runner, existing `src/core/manifest.ts` (parseManifest, expandSources), existing `src/core/git.ts` (readFileAtRef), existing `tests/helpers/git-fixtures.ts`.

**Scope note:** This plan implements ONLY `local:` entries in the origin's `dependencies`. `repo:` and `source:` entries in the origin manifest (cross-repo transitive via origin) are deferred to a follow-up plan — they require on-demand repo resolution and version constraint intersection, which is a larger change. A dev-dep declared in origin produces an informative error; cross-repo entries currently fall through to the conventional probe (and then to an error).

---

## File Structure

**Files touched:**
- `src/core/graph.ts` — add `tryResolveFromOriginManifest` helper; insert into `resolveTransitive` chain; enhance `addUnresolvedError` to report all four lookup locations and dev-dep hint.
- `src/types.ts` — add optional `originDevDepHints` map to `ResolutionState` (this is an internal interface in `graph.ts`, not in `types.ts` — updated in graph.ts only).
- `tests/helpers/git-fixtures.ts` — extend `createTestRepo` with an optional `manifestYaml` parameter so fixtures can commit a `skilltree.yaml` at repo root.
- `tests/core/graph-origin-manifest.test.ts` — **new** unit test file for the feature (keeps the existing `graph.test.ts` focused).
- `docs/specs/reference.md` — document the new resolution tier.

**Why a separate test file:** the existing `graph.test.ts` and `graph-local-source.test.ts` are already >250 lines; a focused test file keeps the new feature's tests easy to read and edit.

---

## Task 1: Extend git-fixtures helper to support a root `skilltree.yaml`

**Files:**
- Modify: `tests/helpers/git-fixtures.ts`

- [ ] **Step 1: Read the existing helper**

Read `tests/helpers/git-fixtures.ts` to confirm the current `createTestRepo` signature and behavior. It currently accepts `baseDir`, `repoName`, `skills[]`, `tagVersion?`.

- [ ] **Step 2: Add `manifestYaml?` parameter**

Modify the `createTestRepo` function signature and body:

```typescript
export async function createTestRepo(
	baseDir: string,
	repoName: string,
	skills: Array<{
		path: string;
		name: string;
		dependencies?: string[];
		isAgent?: boolean;
	}>,
	tagVersion?: string,
	manifestYaml?: string,
): Promise<string> {
	const repoDir = join(baseDir, repoName);
	await mkdir(repoDir, { recursive: true });

	const git = simpleGit(repoDir);
	await git.init();
	await git.addConfig("user.email", "test@test.com");
	await git.addConfig("user.name", "Test");

	// ... existing skills loop stays the same ...

	if (manifestYaml !== undefined) {
		await writeFile(join(repoDir, "skilltree.yaml"), manifestYaml);
	}

	await git.add(".");
	await git.commit("Initial commit");

	if (tagVersion) {
		await git.addTag(tagVersion);
	}

	return repoDir;
}
```

Place the `manifestYaml` write AFTER the skills loop but BEFORE `git.add(".")` so it's part of the initial commit.

- [ ] **Step 3: Run existing tests to verify no regression**

Run: `bun test tests/core/graph.test.ts tests/core/graph-local-source.test.ts tests/core/graph-comprehensive.test.ts`
Expected: All existing tests pass (the new parameter is optional).

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/git-fixtures.ts
git commit -m "test: allow fixture repos to include root skilltree.yaml"
```

---

## Task 2: Write the first failing test — origin manifest `local:` resolves transitive dep

**Files:**
- Create: `tests/core/graph-origin-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/graph-origin-manifest.test.ts`:

```typescript
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAll } from "../../src/core/graph.js";
import type { Manifest } from "../../src/types.js";
import { createTestRepo } from "../helpers/git-fixtures.js";

let tempDir: string;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
	}
});

describe("origin-manifest transitive resolution", () => {
	test("resolves transitive dep declared as local: in origin manifest", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		// Origin repo: parent skill references `child`, child lives at
		// skills/source/child (not the conventional skills/child),
		// origin's skilltree.yaml declares child as local: ./skills/source/child.
		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  child:",
			"    local: ./skills/source/child",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/source/parent", name: "parent", dependencies: ["child"] },
				{ path: "skills/source/child", name: "child" },
			],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			dependencies: {
				parent: {
					repo: `file://${originRepo}`,
					path: "skills/source/parent",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);

		const child = result.entities.get("skill:child");
		expect(child).toBeDefined();
		expect(child?.repo).toBe(`file://${originRepo}`);
		expect(child?.path).toBe("skills/source/child");
		expect(child?.tag).toBe("v1.0.0");
		expect(child?.local).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/graph-origin-manifest.test.ts`
Expected: FAIL. The test fails because `child` is not found — today the same-repo probe looks at `skills/child/SKILL.md`, not `skills/source/child/SKILL.md`. The error will mention the unresolved dependency.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/core/graph-origin-manifest.test.ts
git commit -m "test: add failing test for origin-manifest transitive resolution"
```

---

## Task 3: Implement `tryResolveFromOriginManifest` helper

**Files:**
- Modify: `src/core/graph.ts`

- [ ] **Step 1: Add imports**

In `src/core/graph.ts`, at the top, update the manifest import:

```typescript
import { expandSources, parseManifest } from "./manifest.js";
```

- [ ] **Step 2: Add an `originDevDepHints` field to ResolutionState**

Modify the `ResolutionState` interface (currently starting around line 56 in `src/core/graph.ts`):

```typescript
interface ResolutionState {
	expanded: Manifest;
	projectDir: string;
	entities: Map<string, ResolvedEntity>;
	resolutionContext: Map<string, string>;
	repoResolutions: Map<string, RepoResolution>;
	manifestKeys: Set<string>;
	errors: string[];
	warnings: string[];
	/** depName -> origin repo URL, for informative error when a transitive dep is only in origin's dev-dependencies */
	originDevDepHints: Map<string, string>;
}
```

Then initialize it in `resolveAll` (around line 73):

```typescript
const state: ResolutionState = {
	expanded,
	projectDir,
	entities: new Map(),
	resolutionContext: new Map(),
	repoResolutions: new Map(),
	manifestKeys: new Set([
		...Object.keys(expanded.dependencies ?? {}),
		...Object.keys(expanded["dev-dependencies"] ?? {}),
	]),
	errors: [],
	warnings: [],
	originDevDepHints: new Map(),
};
```

- [ ] **Step 3: Add the helper function**

Add this function in `src/core/graph.ts`, placed right before `tryResolveFromSameRepo` (around line 430):

```typescript
async function tryResolveFromOriginManifest(
	depName: string,
	parentGroup: DependencyGroup,
	parentCompositeKey: string,
	state: ResolutionState,
): Promise<boolean> {
	const parentEntity = state.entities.get(parentCompositeKey);
	if (!parentEntity?.repo) return false;

	const resolution = state.repoResolutions.get(parentEntity.repo);
	if (!resolution) return false;

	const ref = resolution.tag ?? resolution.commit;

	let manifestContent: string;
	try {
		manifestContent = await readFileAtRef(resolution.cachePath, ref, "skilltree.yaml");
	} catch {
		return false;
	}

	let originManifest: Manifest;
	try {
		originManifest = parseManifest(manifestContent);
	} catch {
		return false;
	}

	const expanded = expandSources(originManifest);
	const prodEntry = expanded.dependencies?.[depName];
	const devEntry = expanded["dev-dependencies"]?.[depName];

	if (!prodEntry) {
		if (devEntry) {
			state.originDevDepHints.set(depName, parentEntity.repo);
		}
		return false;
	}

	// Only local: entries are supported in this iteration. Cross-repo
	// (repo:/source:-expanded-to-repo) entries fall through for now.
	if (!isLocalDependency(prodEntry)) {
		return false;
	}

	const localPath = stripDotSlash(prodEntry.local);
	const syntheticDep = {
		repo: parentEntity.repo,
		path: localPath,
		...(prodEntry.type ? { type: prodEntry.type } : {}),
		...(prodEntry.name ? { name: prodEntry.name } : {}),
	};

	const actualName = prodEntry.name ?? depName;
	await resolveEntity(depName, actualName, syntheticDep, parentGroup, state);
	return true;
}
```

- [ ] **Step 4: Wire it into the resolution chain**

Modify `resolveTransitive` (around line 367) to insert the new helper between `tryResolveFromLocalSource` and `tryResolveFromSameRepo`:

```typescript
async function resolveTransitive(
	depName: string,
	parentType: EntityType,
	parentGroup: DependencyGroup,
	parentCompositeKey: string,
	state: ResolutionState,
): Promise<void> {
	if (checkExistingResolution(depName, parentType, parentGroup, parentCompositeKey, state)) return;
	if (await tryResolveFromManifest(depName, parentGroup, state)) return;
	if (await tryResolveFromLocalSource(depName, parentGroup, parentCompositeKey, state)) return;
	if (await tryResolveFromOriginManifest(depName, parentGroup, parentCompositeKey, state)) return;
	if (await tryResolveFromSameRepo(depName, parentGroup, parentCompositeKey, state)) return;
	addUnresolvedError(depName, parentCompositeKey, state);
}
```

- [ ] **Step 5: Run the failing test to verify it now passes**

Run: `bun test tests/core/graph-origin-manifest.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full graph test suite to check for regressions**

Run: `bun test tests/core/graph.test.ts tests/core/graph-local-source.test.ts tests/core/graph-comprehensive.test.ts tests/core/graph-unhappy.test.ts`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/graph.ts
git commit -m "feat: resolve transitive deps via origin repo's skilltree.yaml"
```

---

## Task 4: Convention-layout repos still work (regression guard)

**Files:**
- Modify: `tests/core/graph-origin-manifest.test.ts`

- [ ] **Step 1: Add the test inside the existing describe block**

Append this test to `tests/core/graph-origin-manifest.test.ts`:

```typescript
	test("falls through to conventional probe when origin has no skilltree.yaml", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/parent", name: "parent", dependencies: ["child"] },
				{ path: "skills/child", name: "child" },
			],
			"v1.0.0",
			// No manifestYaml — origin has no skilltree.yaml
		);

		const consumerManifest: Manifest = {
			dependencies: {
				parent: {
					repo: `file://${originRepo}`,
					path: "skills/parent",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		const child = result.entities.get("skill:child");
		expect(child).toBeDefined();
		expect(child?.path).toBe("skills/child");
	});

	test("falls through to conventional probe when origin skilltree.yaml doesn't declare the name", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		// Origin manifest exists but declares a different skill.
		const originManifestYaml = [
			"name: origin",
			"dependencies:",
			"  unrelated:",
			"    local: ./skills/unrelated",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/parent", name: "parent", dependencies: ["child"] },
				{ path: "skills/child", name: "child" },
				{ path: "skills/unrelated", name: "unrelated" },
			],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			dependencies: {
				parent: {
					repo: `file://${originRepo}`,
					path: "skills/parent",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		const child = result.entities.get("skill:child");
		expect(child).toBeDefined();
		expect(child?.path).toBe("skills/child");
	});

	test("malformed origin skilltree.yaml falls through silently", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/parent", name: "parent", dependencies: ["child"] },
				{ path: "skills/child", name: "child" },
			],
			"v1.0.0",
			"not: valid: yaml: [unclosed",
		);

		const consumerManifest: Manifest = {
			dependencies: {
				parent: {
					repo: `file://${originRepo}`,
					path: "skills/parent",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);
		const child = result.entities.get("skill:child");
		expect(child).toBeDefined();
		expect(child?.path).toBe("skills/child");
	});
```

- [ ] **Step 2: Run the new tests**

Run: `bun test tests/core/graph-origin-manifest.test.ts`
Expected: All four tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/core/graph-origin-manifest.test.ts
git commit -m "test: origin-manifest feature falls through cleanly when inapplicable"
```

---

## Task 5: Dev-dependency rejection — informative error

**Files:**
- Modify: `tests/core/graph-origin-manifest.test.ts`
- Modify: `src/core/graph.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/core/graph-origin-manifest.test.ts`:

```typescript
	test("does not expose origin dev-dependencies; error hints at the reason", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		// Origin declares `child` only as a dev-dependency.
		const originManifestYaml = [
			"name: origin",
			"dependencies: {}",
			"dev-dependencies:",
			"  child:",
			"    local: ./skills/source/child",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"origin",
			[
				{ path: "skills/source/parent", name: "parent", dependencies: ["child"] },
				{ path: "skills/source/child", name: "child" },
			],
			"v1.0.0",
			originManifestYaml,
		);

		const consumerManifest: Manifest = {
			dependencies: {
				parent: {
					repo: `file://${originRepo}`,
					path: "skills/source/parent",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors.length).toBe(1);
		const err = result.errors[0];
		expect(err).toContain('declares dependency "child"');
		expect(err).toContain("dev-dependency in origin");
		expect(err).toContain("not exposed to downstream consumers");
	});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/core/graph-origin-manifest.test.ts`
Expected: The new test FAILS — the error message doesn't yet mention dev-dependencies.

- [ ] **Step 3: Update `addUnresolvedError` in `src/core/graph.ts`**

Replace the existing `addUnresolvedError` (around line 467) with:

```typescript
function addUnresolvedError(
	depName: string,
	parentCompositeKey: string,
	state: ResolutionState,
): void {
	const parentEntity = state.entities.get(parentCompositeKey);
	const parentName = parentEntity?.name ?? parentCompositeKey;
	const parentSource = parentEntity?.repo ? `from ${parentEntity.repo}` : "local";
	const devHintRepo = state.originDevDepHints.get(depName);

	const lines = [
		`${parentName} (${parentSource}) declares dependency "${depName}",`,
		`     not found in:`,
		`       - your skilltree.yaml`,
		`       - already-resolved dependencies`,
	];

	if (parentEntity?.repo) {
		lines.push(`       - origin's skilltree.yaml dependencies (${parentEntity.repo})`);
		lines.push(`       - conventional paths in ${parentEntity.repo}`);
	} else {
		lines.push(`       - local filesystem`);
	}

	if (devHintRepo) {
		lines.push("");
		lines.push(
			`     Note: "${depName}" is declared as a dev-dependency in origin's manifest (${devHintRepo}).`,
		);
		lines.push(`     dev-dependencies are not exposed to downstream consumers.`);
		lines.push(
			`     Fix: upstream should move it to \`dependencies\`, or declare ${depName} explicitly in your own skilltree.yaml.`,
		);
	} else {
		lines.push("");
		lines.push(`     Fix: skilltree add ${depName} --repo <repo-url> --path <path>`);
	}

	state.errors.push(lines.join("\n"));
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `bun test tests/core/graph-origin-manifest.test.ts`
Expected: All five tests PASS.

- [ ] **Step 5: Check whether the updated error message broke existing tests**

Run: `bun test tests/core/graph-unhappy.test.ts tests/core/missing-remote-path.test.ts`
Expected: All pass. If any existing test asserts substrings of the error message (e.g., "not found in: manifest, resolution context"), update those assertions to match the new multi-line format. Only update the test strings — do not weaken assertions.

- [ ] **Step 6: Run the full test suite**

Run: `bun test`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/graph.ts tests/core/graph-origin-manifest.test.ts
# Include any test files where assertions were updated
git commit -m "feat: informative error when transitive dep is upstream dev-only"
```

---

## Task 6: Integration test for the nested-source-layout-style scenario

**Files:**
- Modify: `tests/core/graph-origin-manifest.test.ts`

- [ ] **Step 1: Add the integration test**

Append to `tests/core/graph-origin-manifest.test.ts`:

```typescript
	test("nested-source-layout scenario: multi-level transitive chain through unconventional layout", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skilltree-origin-manifest-"));

		// Origin layout mimics nested-source-layout: skills under skills/source/<name>.
		// task-builder depends on hypothesis-building-task AND task-naming.
		// Origin's manifest declares both as local:.
		const originManifestYaml = [
			"name: nested-source-layout",
			"dependencies:",
			"  task-builder:",
			"    local: ./skills/source/task-builder",
			"  hypothesis-building-task:",
			"    local: ./skills/source/hypothesis-building-task",
			"  task-naming:",
			"    local: ./skills/source/task-naming",
			"",
		].join("\n");

		const originRepo = await createTestRepo(
			tempDir,
			"nested-source-layout",
			[
				{
					path: "skills/source/task-builder",
					name: "task-builder",
					dependencies: ["hypothesis-building-task", "task-naming"],
				},
				{
					path: "skills/source/hypothesis-building-task",
					name: "hypothesis-building-task",
				},
				{ path: "skills/source/task-naming", name: "task-naming" },
			],
			"v2.0.0",
			originManifestYaml,
		);

		// Consumer only declares task-builder; transitive deps should auto-resolve.
		const consumerManifest: Manifest = {
			dependencies: {
				"task-builder": {
					repo: `file://${originRepo}`,
					path: "skills/source/task-builder",
					version: "*",
				},
			},
		};

		const result = await resolveAll(consumerManifest, tempDir);

		expect(result.errors).toEqual([]);

		const taskBuilder = result.entities.get("skill:task-builder");
		const hyp = result.entities.get("skill:hypothesis-building-task");
		const naming = result.entities.get("skill:task-naming");

		expect(taskBuilder).toBeDefined();
		expect(hyp).toBeDefined();
		expect(naming).toBeDefined();

		// All three share the origin repo and tag.
		expect(taskBuilder?.tag).toBe("v2.0.0");
		expect(hyp?.tag).toBe("v2.0.0");
		expect(naming?.tag).toBe("v2.0.0");

		// Transitive deps point at the unconventional paths from origin's manifest.
		expect(hyp?.path).toBe("skills/source/hypothesis-building-task");
		expect(naming?.path).toBe("skills/source/task-naming");
	});
```

- [ ] **Step 2: Run the test**

Run: `bun test tests/core/graph-origin-manifest.test.ts`
Expected: All six tests PASS (includes the new integration test).

- [ ] **Step 3: Commit**

```bash
git add tests/core/graph-origin-manifest.test.ts
git commit -m "test: end-to-end nested-source-layout-style transitive resolution"
```

---

## Task 7: Update documentation

**Files:**
- Modify: `docs/specs/reference.md`

- [ ] **Step 1: Locate the "Transitive resolution priority" section**

Find the existing block in `docs/specs/reference.md` near line 169 that reads:

```
**Transitive resolution priority:**
1. Manifest lookup (either group)
2. Resolution context (already resolved by another chain)
3. Same-repo default (look in the same repo as the parent entity)
4. Error (with actionable fix message)
```

- [ ] **Step 2: Update it to reflect the new tier**

Replace with:

```
**Transitive resolution priority:**
1. Resolution context (already resolved by another chain)
2. Manifest lookup (consumer's `skilltree.yaml`, either group)
3. Local-source probe (when the parent is a local dep, look inside its source dir)
4. Origin-manifest lookup (when the parent is a remote dep, read the origin repo's `skilltree.yaml` at the pinned ref and look up `dependencies[name]`; `dev-dependencies` are NOT exposed to downstream consumers)
5. Same-repo conventional probe (`skills/<name>/SKILL.md`, `agents/<name>.md`, `<name>/SKILL.md`)
6. Error (with actionable fix message)

**Origin-manifest lookup details:**
- Only `dependencies` from origin are consulted, never `dev-dependencies`.
- If origin's entry is `local: ./path/in/repo`, it is treated as a same-repo dep pinned to the parent's tag. This lets authors organize skills at any path (e.g., `skills/source/<name>/`) while keeping auto-resolution for consumers.
- If origin's entry is `repo:`/`source:` (cross-repo), it currently falls through to the conventional probe — cross-repo transitive via origin manifest is a planned follow-up.
- If origin's `skilltree.yaml` is missing, malformed, or doesn't declare the name, resolution falls through silently to the conventional probe.
- If origin declared the name only under `dev-dependencies`, the error message includes a specific hint pointing at the upstream author.
```

- [ ] **Step 3: Commit**

```bash
git add docs/specs/reference.md
git commit -m "docs: document origin-manifest transitive resolution"
```

---

## Task 8: Verify end-to-end against the real backendv2-y layout

**Files:** (no code changes; manual verification)

- [ ] **Step 1: Rebuild the local skilltree binary**

Run: `bun run build` (if this repo uses `make`, run `make build` instead — check `package.json` scripts first).
Expected: Fresh `dist/skilltree` binary.

- [ ] **Step 2: Simulate a consumer of nested-source-layout**

Create a throwaway directory outside the repo:

```bash
TMPDIR=$(mktemp -d)
cd "$TMPDIR"
cat > skilltree.yaml <<'EOF'
name: test-consumer
install_targets:
  - claude
dependencies:
  task-builder:
    repo: file:///Users/imarios/Projects/backendv2-y
    path: skills/source/task-builder
    version: "*"
EOF
```

Note: `file://` URLs against a non-bare repo require the repo to have at least one commit and (for tag-based resolution) a tag. Before running install, confirm `~/Projects/backendv2-y` has a tag with `git -C ~/Projects/backendv2-y tag --list`. If there are no tags, resolution uses the default branch (tagless path, documented in `resolveOneRepo`).

- [ ] **Step 3: Run install**

Run: `/Users/imarios/Projects/skilltree/dist/skilltree install`
Expected: `task-builder` AND its transitive deps (`hypothesis-building-task`, `task-naming`, etc.) all resolve and install. No "not found" errors for transitive deps that are declared as `local:` in backendv2-y's manifest.

If any transitive dep still fails to resolve, investigate:
- Is that dep declared in `~/Projects/backendv2-y/skilltree.yaml` under `dependencies` (not `dev-dependencies`)?
- If not, it needs explicit manifest declaration on the consumer side — that's the expected behavior.

- [ ] **Step 4: Cleanup**

```bash
rm -rf "$TMPDIR"
```

- [ ] **Step 5: No commit — this task is verification only.**

---

## Self-Review

**Spec coverage:**
- Spec §"Resolution order" → Task 3 Step 4
- Spec §"Origin-manifest lookup semantics" (local:) → Task 3 Step 3
- Spec §"Origin-manifest lookup semantics" (repo:/source:) → Deferred, documented in Task 7 and scope note
- Spec §"Versioning rules" (local: inherits parent tag) → Task 2 assertion on `tag`, Task 6 assertion across all three entities
- Spec §"Error message" → Task 5
- Spec §"Decision 1" (prod-only) → Task 5
- Spec §"Decision 2" (manifest-first, convention fallback) → Task 3 Step 4 ordering, Task 4 fallthrough tests
- Spec §"Decision 3" (silent fall-through) → Task 4 (three fall-through scenarios)
- Spec §"Decision 4" (parsed at parent's ref, not HEAD) → Task 3 Step 3 reads at `resolution.tag ?? resolution.commit`
- Spec §"Testing strategy" — all bullets covered except the cross-repo `repo:` and `source:` cases, which are deferred.

**Placeholder scan:** None.

**Type consistency:**
- `tryResolveFromOriginManifest` signature matches `tryResolveFromSameRepo` (same 4 params, returns `Promise<boolean>`).
- `state.originDevDepHints` is `Map<string, string>` everywhere it's referenced.
- `syntheticDep` shape matches `RemoteDependency` type (repo, path, optional type, optional name).
- `resolveEntity` is called with 5 args matching its signature.
