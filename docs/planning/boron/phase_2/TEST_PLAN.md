# Phase 2 Test Plan — R10 Warnings + side-quest

File: `tests/core/graph-path-warnings.test.ts`

## R10 matrix

| # | Scenario | Expected |
|---|----------|----------|
| 1 | consumer `path:` == origin's `local:` | redundant warning with "omit `path:`" hint |
| 2 | consumer `path:` == origin's same-repo `repo:` path | redundant warning |
| 3 | consumer `path:` != origin's declared path | override warning naming both paths + `force_path` tip |
| 4 | origin doesn't declare name | no warning |
| 5 | origin declares name only in dev-dependencies | no warning |
| 6 | `force_path: true` + matching path | no warning |
| 7 | `force_path: true` + differing path | no warning |
| 8 | `force_path: true` + origin doesn't declare | no warning, no error |

## Side-quest audit tests

| # | Scenario | Expected |
|---|----------|----------|
| S1 | Undefined `source:` alias → error at expand time | error includes "Unknown source alias" |
| S2 | `source:` URL + path missing + origin has nothing → R9 error | error mentions "no path" and the inferred repo URL |

(Assuming S1 and S2 aren't already covered — will grep before writing.)
