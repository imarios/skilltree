#!/usr/bin/env bash
set -euo pipefail

# Publish all skilltree npm packages (platform binaries + main package).
# Usage: ./scripts/publish-npm.sh [--dry-run]
#
# Prerequisites:
#   - Run ./scripts/build-npm.sh first
#   - Be logged in to npm (npm login)
#   - Have publish access to @skilltree org

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DRY_RUN=""
PROVENANCE=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
  echo "DRY RUN MODE - no packages will be published"
fi

# Enable provenance attestation when running in GitHub Actions
if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
  PROVENANCE="--provenance"
  echo "CI detected — publishing with provenance attestation"
fi

VERSION=$(node -p "require('$ROOT_DIR/package.json').version")
echo "Publishing skilltree v${VERSION}..."

# Verify all binaries exist
PLATFORMS=("cli-darwin-arm64" "cli-darwin-x64" "cli-linux-x64" "cli-linux-arm64")
for dir in "${PLATFORMS[@]}"; do
  bin="$ROOT_DIR/npm/$dir/bin/skilltree"
  if [[ ! -f "$bin" ]]; then
    echo "ERROR: Missing binary $bin"
    echo "Run ./scripts/build-npm.sh first."
    exit 1
  fi

  # Verify version matches
  pkg_version=$(node -p "require('$ROOT_DIR/npm/$dir/package.json').version")
  if [[ "$pkg_version" != "$VERSION" ]]; then
    echo "ERROR: Version mismatch in npm/$dir/package.json ($pkg_version != $VERSION)"
    echo "Run ./scripts/build-npm.sh to sync versions."
    exit 1
  fi
done

# Publish platform packages first
for dir in "${PLATFORMS[@]}"; do
  echo ""
  echo "Publishing @skilltree/$dir@${VERSION}..."
  (cd "$ROOT_DIR/npm/$dir" && npm publish --access public $DRY_RUN $PROVENANCE)
done

# Publish main package last
echo ""
echo "Publishing skilltree@${VERSION}..."
(cd "$ROOT_DIR" && npm publish --access public $DRY_RUN $PROVENANCE)

echo ""
echo "Done! Published:"
echo "  skilltree@${VERSION}"
for dir in "${PLATFORMS[@]}"; do
  echo "  @skilltree/$dir@${VERSION}"
done
echo ""
echo "Users can now run: npx skilltree"
