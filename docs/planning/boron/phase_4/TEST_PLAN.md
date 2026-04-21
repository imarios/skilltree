# Phase 4 Test Plan — Real-World Verification

Doc changes are unit-testable only for the false-positive fix; the rest is verified via live `skilltree install` against `~/Projects/backendv2-y`.

## New test for false-positive fix

Covered in existing R10 scenarios: test 4 ("origin doesn't declare name → no warning") and test 5 ("dev-dep only → no warning") both rely on the `fromConsumerManifest` flag being correctly threaded. The full R9 suite (13 tests) also verifies that transitive deps resolve without emitting false-positive warnings — test 4 of R9 (cross-repo fall-through) specifically walks this code path.

If additional safety is desired later, add a dedicated unit test asserting `result.warnings` is empty when the consumer declares only `task-builder` and 4 transitive entries would otherwise produce warnings. Noted but deferred — the real-world verification captures it.

## Real-world verification script

```bash
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/skilltree.yaml" <<'EOF'
name: test-consumer
install_targets: [claude]
dependencies:
  task-builder:
    repo: file:///Users/imarios/Projects/backendv2-y
EOF
cd "$TMPDIR" && /Users/imarios/Projects/skilltree/dist/skilltree install
```

Expected: 5 skills installed, 0 warnings, 0 errors.

## Expected warning behavior

Add explicit `path: skills/source/task-builder` to the consumer manifest → warning fires naming origin repo + path match. `force_path: true` suppresses.
