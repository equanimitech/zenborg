#!/usr/bin/env bash
# Bump the version across package.json, tauri.conf.json and the Claude Code
# plugin manifest, then commit and tag. One version for the app and the
# plugin: /plugin update only sees a release when plugin.json moves.
#
# Usage:
#   ./scripts/bump-version.sh          # patch bump (0.18.0 → 0.18.1)
#   ./scripts/bump-version.sh minor    # minor bump (0.18.0 → 0.19.0)
#   ./scripts/bump-version.sh major    # major bump (0.18.0 → 1.0.0)
#   ./scripts/bump-version.sh 0.20.0   # explicit version

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$ROOT/package.json"
TAURI="$ROOT/src-tauri/tauri.conf.json"
PLUGIN="$ROOT/plugin/.claude-plugin/plugin.json"

current=$(node -p "require('$PKG').version")
IFS='.' read -r major minor patch <<< "$current"

case "${1:-patch}" in
  patch) next="$major.$minor.$((patch + 1))" ;;
  minor) next="$major.$((minor + 1)).0" ;;
  major) next="$((major + 1)).0.0" ;;
  [0-9]*) next="$1" ;;
  *) echo "Usage: bump-version.sh [patch|minor|major|X.Y.Z]" >&2; exit 1 ;;
esac

echo "$current → $next"

node -e "
  const fs = require('fs');
  for (const f of ['$PKG', '$TAURI', '$PLUGIN']) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j.version = '$next';
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  }
"

cd "$ROOT"
git add package.json src-tauri/tauri.conf.json plugin/.claude-plugin/plugin.json
git commit -m "chore: bump version to $next"
git tag "v$next"

echo "Tagged v$next. Push with: git push origin main --tags"
