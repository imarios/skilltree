# Phase 5 Test Plan

## `canonicalPath` (tests/core/paths.test.ts)

Parametrized: each input should canonicalize to `skills/foo`:

| Input | Notes |
|-------|-------|
| `skills/foo` | identity |
| `./skills/foo` | leading `./` |
| `/skills/foo` | leading `/` (git tree-relative convention) |
| `skills/foo/` | trailing `/` |
| `././skills/foo` | repeated `./` |
| `./skills/foo/` | combined |
| `skills//foo` | internal duplicate `/` |
| `/./skills/foo` | leading `/` + `./` |

Plus negative cases:
- `` (empty string) → `""` unchanged.
- `skills/foo/..` — `..` segments pass through (we don't resolve them; `hasDotDotSegment` guards elsewhere).

## `canonicalSource` (tests/core/deps.test.ts)

| Dep | Sources map | Expected |
|-----|-------------|----------|
| `{repo: "github.com/x/y"}` | any | `"github.com/x/y"` |
| `{source: "vibes"}` | `{vibes: "github.com/x/y"}` | `"github.com/x/y"` |
| `{source: "vibes"}` | `{}` (alias missing) | `"unresolved source alias: vibes"` (unspoofable sentinel — no git URL begins with whitespace) |
| `{source: "mine"}` + path `foo` | `{mine: "~/skills"}` | `"local:<expanded>/foo"` |
| `{local: "~/skills/foo"}` | any | `"local:<expanded>/foo"` (matches the source-aliased form above) |
| `{}` | any | `"local"` |
| `undefined` | any | `"local"` |

## `addCommand` overwrite-preservation invariant (tests/commands/add.test.ts)

Extend the existing R11 test or add a sibling: re-adding a dep preserves any field CLI opts don't explicitly set. Cover `force_path`, `type`, and `name` (alias) — set them all in the seeded manifest, re-add with just `--repo/--path`, assert all three survived.
