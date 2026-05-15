#!/usr/bin/env bash
# Build the bun-compiled `zenborg-mcp` sidecar for the current Rust target
# triple and stage it under `src-tauri/binaries/zenborg-mcp-<triple>` for
# Tauri's `bundle.externalBin`.
#
# Invoked by Tauri's `beforeBundleCommand`. The triple suffix is required by
# Tauri sidecars: it picks up `binaries/zenborg-mcp-<triple>` at bundle
# time and strips the suffix when copying into `Contents/MacOS/`.
#
# Override the target by exporting TARGET (CI sets this for cross-builds).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MCP_DIR="$WORKSPACE_ROOT/mcp-server"
DEST="$WORKSPACE_ROOT/src-tauri/binaries"

# Resolve bun. Tauri's beforeBundleCommand inherits the macOS GUI default
# PATH when launched from `tauri build` via Finder / IDEs, so fall back to
# the standard install location.
BUN="${BUN:-}"
if [[ -z "$BUN" ]]; then
  if command -v bun >/dev/null 2>&1; then
    BUN="$(command -v bun)"
  elif [[ -x "$HOME/.bun/bin/bun" ]]; then
    BUN="$HOME/.bun/bin/bun"
  else
    echo "[sidecars] bun not found on PATH or at ~/.bun/bin/bun" >&2
    echo "[sidecars]   install with: curl -fsSL https://bun.sh/install | bash" >&2
    exit 1
  fi
fi

TARGET="${TARGET:-$(rustc -vV | sed -n 's|host: ||p')}"
echo "[sidecars] bun    = $BUN"
echo "[sidecars] target = $TARGET"

cd "$MCP_DIR"

# Ensure deps are present (pnpm-managed). Skip if node_modules is already
# populated to keep beforeBundle fast on incremental builds.
if [[ ! -d node_modules ]]; then
  echo "[sidecars] installing deps (pnpm)"
  pnpm install --frozen-lockfile
fi

mkdir -p dist
echo "[sidecars] compiling zenborg-mcp"
"$BUN" build index.ts --compile --target=bun --outfile dist/zenborg-mcp

mkdir -p "$DEST"
cp dist/zenborg-mcp "$DEST/zenborg-mcp-$TARGET"
chmod +x "$DEST/zenborg-mcp-$TARGET"

echo "[sidecars] staged:"
ls -lh "$DEST"
