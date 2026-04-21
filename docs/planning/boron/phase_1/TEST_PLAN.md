# Phase 1 Test Plan — R9 Direct-Dep Path Inference

All tests live in `tests/core/graph-direct-path-inference.test.ts`.

| # | Test name | Scenario | Expectation |
|---|-----------|----------|-------------|
| 1 | infers path from origin's `local:` entry | direct dep `{repo, no path}`, origin manifest declares name as `local: ./skills/source/foo` | resolves with path `skills/source/foo` |
| 2 | infers path from origin's same-repo `repo:` entry | origin declares `foo: {repo: <self>, path: skills/source/foo}` | resolves with origin's path |
| 3 | infers path from `source:` alias without `path:` | consumer uses `source: alias` no path, origin declares name | resolves via origin |
| 4 | cross-repo origin entry → fall-through to convention probe | origin declares name with `repo:` pointing at different repo; convention path exists | resolves via probe |
| 5 | cross-repo origin entry + no convention hit → R9 error | same but convention path missing | clear R9 error naming origin repo + probe paths |
| 6 | absolute `local:` in origin → fall-through | origin `source: mine: /abs/path`, name under it | skipped, convention probe used |
| 7 | origin doesn't declare name, convention probe hits | origin manifest present, name not in it; `skills/<name>` exists | resolves via probe |
| 8 | origin doesn't declare name, convention probe misses | nothing works | R9 error |
| 9 | origin `skilltree.yaml` missing, convention probe | no manifest file | probe works |
| 10 | origin `skilltree.yaml` malformed, convention probe | bad YAML | probe works |
| 11 | origin declares name only in `dev-dependencies` | not exposed | fall-through to probe; R9 error if probe misses |
| 12 | aliased YAML key, origin declares actual name | consumer `foo-key: {repo, name: actual-foo}`, origin has `actual-foo:` | lookup by `actual-foo`, resolves |
| 13 | agent direct dep, no path, origin declares agent | origin has `my-agent: {local: ./agents/my-agent.md, type: agent}` | resolves with `type: agent` |

Manifest validation regression check (inline in same file or a new unit test):

| # | Test | Expectation |
|---|------|-------------|
| V1 | `validateManifest` with remote dep missing `path:` | returns no errors (was previously an error) |
| V2 | `validateManifest` with mutually exclusive `repo:` + `local:` | still errors |
| V3 | `parseManifest` round-trip with `force_path: true` | field preserved |
