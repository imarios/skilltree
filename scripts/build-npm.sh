#!/usr/bin/env bash
set -euo pipefail

# Build platform-specific npm packages for skilltree.
# Usage: ./scripts/build-npm.sh
#
# Reads version from root package.json, cross-compiles for all targets,
# places binaries in npm/cli-*/bin/, and syncs versions.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION=$(node -p "require('$ROOT_DIR/package.json').version")
echo "Building skilltree v${VERSION} for all platforms..."

# Platform pairs: "directory:bun-target"
PLATFORMS=(
  "cli-darwin-arm64:bun-darwin-arm64"
  "cli-darwin-x64:bun-darwin-x64"
  "cli-linux-x64:bun-linux-x64"
  "cli-linux-arm64:bun-linux-arm64"
)

# Sync version in all platform package.json files
for entry in "${PLATFORMS[@]}"; do
  dir="${entry%%:*}"
  pkg="$ROOT_DIR/npm/$dir/package.json"
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$pkg', 'utf8'));
    pkg.version = '$VERSION';
    fs.writeFileSync('$pkg', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "  $dir/package.json -> v${VERSION}"
done

# Sync optionalDependencies versions in root package.json
node -e "
  const fs = require('fs');
  const pkgPath = '$ROOT_DIR/package.json';
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  for (const key of Object.keys(pkg.optionalDependencies || {})) {
    pkg.optionalDependencies[key] = '$VERSION';
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
"
echo "  root package.json optionalDependencies -> v${VERSION}"

# Cross-compile for each target
for entry in "${PLATFORMS[@]}"; do
  dir="${entry%%:*}"
  target="${entry##*:}"
  outfile="$ROOT_DIR/npm/$dir/bin/skilltree"
  echo "  Compiling $dir ($target)..."
  bun build --compile --target="$target" "$ROOT_DIR/src/cli.ts" --outfile "$outfile"
  chmod +x "$outfile"
  echo "  -> $(du -h "$outfile" | cut -f1) $outfile"
done

echo ""
echo "Build complete. Binaries:"
ls -lh "$ROOT_DIR"/npm/*/bin/skilltree
