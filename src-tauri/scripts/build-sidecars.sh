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

# ── zenborg-calendar (Swift, EventKit) ───────────────────────────────
CAL_DIR="$WORKSPACE_ROOT/calendar-sidecar"
if [[ -d "$CAL_DIR/Sources" ]]; then
  echo "[sidecars] compiling zenborg-calendar (swiftc)"
  mkdir -p "$CAL_DIR/dist"
  # Pin minos: swiftc defaults to the build host's OS, so a macOS 26 CI
  # runner emits a binary that dyld refuses on older Macs. 14.0 is the floor
  # for EventKit's requestFullAccessToEvents.
  xcrun swiftc -O -target "$(uname -m)-apple-macos14.0" "$CAL_DIR"/Sources/*.swift \
    -o "$CAL_DIR/dist/zenborg-calendar" \
    -framework EventKit -framework Foundation
  cp "$CAL_DIR/dist/zenborg-calendar" "$DEST/zenborg-calendar-$TARGET"
  chmod +x "$DEST/zenborg-calendar-$TARGET"

  # Verify the reconciler port against the shared truth-table vectors
  if [[ -f "$CAL_DIR/fixtures/reconcile-vectors.json" ]]; then
    echo "[sidecars] running zenborg-calendar self-test"
    "$CAL_DIR/dist/zenborg-calendar" self-test "$CAL_DIR/fixtures/reconcile-vectors.json"
  fi
fi

# ── zenborg-native-host (Rust, Chrome extension relay) ─────────────
NH_DIR="$WORKSPACE_ROOT/src-tauri/crates/native-host"
if [[ -d "$NH_DIR/src" ]]; then
  echo "[sidecars] compiling zenborg-native-host (cargo)"
  cargo build --release --manifest-path "$NH_DIR/Cargo.toml"
  NH_BIN="$WORKSPACE_ROOT/src-tauri/target/release/zenborg-native-host"
  if [[ -f "$NH_BIN" ]]; then
    cp "$NH_BIN" "$DEST/zenborg-native-host-$TARGET"
    chmod +x "$DEST/zenborg-native-host-$TARGET"
  else
    echo "[sidecars] zenborg-native-host binary not found at $NH_BIN" >&2
    exit 1
  fi
fi

# ── zenborg-daemon (Rust, observer + scheduler) ─────────────────────
DAEMON_DIR="$WORKSPACE_ROOT/src-tauri/crates/zenborg-daemon"
if [[ -d "$DAEMON_DIR/src" ]]; then
  echo "[sidecars] compiling zenborg-daemon (cargo)"
  cargo build --release --manifest-path "$DAEMON_DIR/Cargo.toml"
  DAEMON_BIN="$WORKSPACE_ROOT/src-tauri/target/release/zenborg-daemon"
  if [[ -f "$DAEMON_BIN" ]]; then
    cp "$DAEMON_BIN" "$DEST/zenborg-daemon-$TARGET"
    chmod +x "$DEST/zenborg-daemon-$TARGET"
  else
    echo "[sidecars] zenborg-daemon binary not found at $DAEMON_BIN" >&2
    exit 1
  fi
fi

echo "[sidecars] staged:"
ls -lh "$DEST"
