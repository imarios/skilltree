# Carbon Phase 1 — Test Plan

## tests/core/visibility.test.ts (new)

Parametrized table over the 4 combinations + omitted-publish default:

| group | publish | expected |
|---|---|---|
| `dependencies` | `undefined` | `true` |
| `dependencies` | `true` | `true` |
| `dependencies` | `false` | `false` |
| `dev-dependencies` | `undefined` | `false` |
| `dev-dependencies` | `true` | `false` |
| `dev-dependencies` | `false` | `false` |

Plus type-coverage tests:
- Works on `LocalDependency` with `publish` set.
- Works on `RemoteDependency` (publish field doesn't exist; defaults to visible if in `dependencies`).
- Works on `SourceDependency`.

## tests/core/manifest-publish-exclude.test.ts (new)

### Round-trip (positive)

- Parse YAML with `publish: false` on a local entry → field present on parsed object.
- Parse YAML with `exclude: ["experiments/"]` on a local entry → field present.
- Serialize → string contains the field.
- Round-trip (parse → serialize → parse) preserves both fields.

### Validation (negative)

- `publish: false` on a `repo:` entry → validation error mentioning the field is local-only.
- `publish: true` on a `source:` entry → same error.
- `exclude: [...]` on a `repo:` entry → validation error.
- `exclude: [...]` on a `source:` entry → validation error.

### Validation (type errors)

- `publish: "false"` (string, not boolean) → validation error.
- `publish: 1` → validation error.
- `exclude: "experiments/"` (string, not list) → validation error.
- `exclude: [1, 2]` (list of non-strings) → validation error.

### Validation (positive)

- `publish: false` on a `local:` entry → no errors.
- `publish: true` on a `local:` entry → no errors.
- `exclude: []` on a `local:` entry → no errors (empty list is valid).
- `exclude: ["a/", "b/*"]` on a `local:` entry → no errors.
- `publish` and `exclude` both on a `local:` entry → no errors.

### Interaction with existing rules

- `publish: false` on a local entry in `dev-dependencies` → no validation error (the flag is allowed; it's just redundant since dev-deps are already not exposed). Document this as expected behavior.
