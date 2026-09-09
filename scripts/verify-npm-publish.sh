#!/usr/bin/env bash
set -euo pipefail

# Confirm a freshly published version is readable from the npm registry.
#
# Usage: ./scripts/verify-npm-publish.sh <package> <version>
#
# Runs immediately after `npm publish`, so by the time this executes the
# publish has already exited 0. What it checks is *visibility*: the registry
# is read-after-write eventual, and a version can take minutes to become
# resolvable. That is why a timeout here is not a failed release, and why the
# failure message says so — #170 was a genuinely refused publish that left a
# tag with nothing on npm, and the two must not look alike in the runs list.
#
# The budget was 6 × 15s in a step whose own comment said propagation "can
# take 30-90s" — the cap equal to the upper bound it existed to absorb, so a
# release at typical worst case failed (#198). It is now 20 × 15s = 5 minutes.
# Overridable via VERIFY_ATTEMPTS / VERIFY_DELAY so tests need not wait.
#
# Lives here rather than inline in the workflows because release.yml and
# publish.yml both need it and carried byte-identical copies; the loop has
# been edited twice already (#39, #198).

PACKAGE="${1:-}"
VERSION="${2:-}"
if [[ -z "$PACKAGE" || -z "$VERSION" ]]; then
  echo "usage: $0 <package> <version>" >&2
  exit 2
fi

ATTEMPTS="${VERIFY_ATTEMPTS:-20}"
DELAY="${VERIFY_DELAY:-15}"

for ((i = 1; i <= ATTEMPTS; i++)); do
  if npm view "${PACKAGE}@${VERSION}" version >/dev/null 2>&1; then
    echo "✔ Verified ${PACKAGE}@${VERSION} on npm (attempt ${i})"
    exit 0
  fi
  echo "Not readable yet (attempt ${i}/${ATTEMPTS}) — waiting ${DELAY}s..."
  sleep "$DELAY"
done

# Deliberately explicit: the artifact is probably fine and the job is safe to
# re-run. Anyone reading this needs to know it is not the #170 failure.
echo "::error::${PACKAGE}@${VERSION} is still not readable from the registry after $((ATTEMPTS * DELAY))s."
echo "The publish step ahead of this one already reported success, so this is registry propagation rather than a refused publish."
echo "Check with: npm view ${PACKAGE}@${VERSION} version"
echo "If it resolves, the release is fine and you can re-run this job to go green."
exit 1
