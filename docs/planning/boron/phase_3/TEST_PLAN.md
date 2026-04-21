# Phase 3 Test Plan — R13

Tests inline in `tests/commands/add.test.ts`.

| # | Test | Expected |
|---|------|----------|
| R13-1 | `add task-builder --repo <url> --version ^2.0.0` (no --path) | Entry written; `path` key absent |
| R13-2 | `add python-coding --source vibes --version ^2.0.0` (no --path) | Entry written; `path` key absent |
| (regression) | Old "require --path" test updated to the new R13 positive cases | Old behavior gone, new covered |
