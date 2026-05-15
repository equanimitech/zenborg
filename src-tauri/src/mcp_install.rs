//! Auto-wire the bundled `zenborg-mcp` sidecar into Claude Desktop and
//! Claude Code on app launch.
//!
//! Adapted from secretariat's `crates/cli/src/commands/mcp.rs`. The shape
//! is the same — locate the bundled binary, merge our entry into the
//! client config (atomic write for Desktop, `claude mcp add` for Code) —
//! but everything lives in-process under Tauri rather than a separate
//! CLI sub-command. The principal never opens a Terminal.
//!
//! Wiring is idempotent: a marker file at `~/.zenborg/.mcp-wired-binary`
//! records the bundled binary path + app version. We re-wire only when
//! that signature changes (app upgrade, app moved).

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use serde_json::{Map, Value};
use tempfile::NamedTempFile;

const SERVER_NAME: &str = "zenborg";
const MARKER_FILE: &str = ".mcp-wired-binary";

// ────────────────────────────────────────────────────────────────────────
// Status (for the Settings UI)
// ────────────────────────────────────────────────────────────────────────

#[derive(Serialize, Debug, Clone)]
pub struct IntegrationStatus {
    /// Did we detect the client (Claude Code CLI on PATH / Claude Desktop
    /// config dir present)?
    pub client_detected: bool,
    /// Is our entry currently registered?
    pub registered: bool,
    /// Where the client's config lives (for the UI to surface).
    pub config_path: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct IntegrationsStatus {
    pub claude_code: IntegrationStatus,
    pub claude_desktop: IntegrationStatus,
    /// Path to the bundled `zenborg-mcp` we'd wire into clients. `None`
    /// when running a `tauri dev` build (no sidecar staged).
    pub bundled_binary: Option<String>,
}

pub fn status() -> IntegrationsStatus {
    IntegrationsStatus {
        claude_code: claude_code_status(),
        claude_desktop: claude_desktop_status(),
        bundled_binary: bundled_zenborg_mcp_path()
            .ok()
            .map(|p| p.display().to_string()),
    }
}

// ────────────────────────────────────────────────────────────────────────
// Install — public entry points
// ────────────────────────────────────────────────────────────────────────

/// Wire both clients. Returns the binary path we wired so callers can log
/// it. Errors only if neither client could be wired.
pub fn install_all() -> Result<PathBuf> {
    let binary = bundled_zenborg_mcp_path()?;
    let mut wired_anywhere = false;

    match wire_claude_desktop(&binary) {
        Ok(path) => {
            log::info!(
                "[mcp] wired Claude Desktop config: {} (restart app for tools to appear)",
                path.display()
            );
            wired_anywhere = true;
        }
        Err(e) => log::info!("[mcp] (skipped Claude Desktop) {e}"),
    }

    match wire_claude_code(&binary) {
        Ok(()) => {
            log::info!("[mcp] wired Claude Code (user scope)");
            wired_anywhere = true;
        }
        Err(e) => log::info!("[mcp] (skipped Claude Code) {e}"),
    }

    if !wired_anywhere {
        return Err(anyhow!(
            "neither Claude Desktop nor Claude Code was wired"
        ));
    }
    Ok(binary)
}

/// Idempotent wrapper: run `install_all` only if the marker file doesn't
/// already record the current `(binary path | app version)` signature.
pub fn install_once_per_version(app_version: &str) -> Result<()> {
    let binary = bundled_zenborg_mcp_path()?;
    let signature = format!("{}|{}", binary.display(), app_version);

    let marker = marker_path()?;
    if let Ok(prev) = std::fs::read_to_string(&marker) {
        if prev.trim() == signature {
            log::debug!("[mcp] already wired for this build, skipping");
            return Ok(());
        }
    }

    install_all()?;

    if let Some(parent) = marker.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&marker, &signature)
        .with_context(|| format!("writing marker {}", marker.display()))?;
    Ok(())
}

fn marker_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("no home dir"))?;
    Ok(home.join(".zenborg").join(MARKER_FILE))
}

// ────────────────────────────────────────────────────────────────────────
// Bundled binary resolution
// ────────────────────────────────────────────────────────────────────────

/// Locate `zenborg-mcp` next to the running Tauri exe (inside
/// `zenborg.app/Contents/MacOS/`). Returns `Err` for `tauri dev` builds
/// where no sidecar is staged.
fn bundled_zenborg_mcp_path() -> Result<PathBuf> {
    let exe = std::env::current_exe().context("current_exe")?;
    let dir = exe
        .parent()
        .ok_or_else(|| anyhow!("current exe has no parent dir"))?;
    let candidate = dir.join("zenborg-mcp");
    if !candidate.exists() {
        return Err(anyhow!(
            "bundled zenborg-mcp not present next to app exe ({}); dev build?",
            dir.display()
        ));
    }
    Ok(candidate)
}

// ────────────────────────────────────────────────────────────────────────
// Claude Desktop — atomic JSON merge
// ────────────────────────────────────────────────────────────────────────

fn claude_desktop_config_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("no home dir"))?;
    #[cfg(target_os = "macos")]
    let path = home
        .join("Library")
        .join("Application Support")
        .join("Claude")
        .join("claude_desktop_config.json");
    #[cfg(target_os = "linux")]
    let path = home
        .join(".config")
        .join("Claude")
        .join("claude_desktop_config.json");
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let path = {
        let _ = home;
        return Err(anyhow!("Claude Desktop config path unknown on this OS"));
    };
    Ok(path)
}

fn claude_desktop_status() -> IntegrationStatus {
    let path = match claude_desktop_config_path() {
        Ok(p) => p,
        Err(_) => {
            return IntegrationStatus {
                client_detected: false,
                registered: false,
                config_path: None,
            };
        }
    };
    let parent_exists = path.parent().map(|p| p.exists()).unwrap_or(false);
    let registered = if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .and_then(|v| v.get("mcpServers").cloned())
            .and_then(|v| v.get(SERVER_NAME).cloned())
            .is_some()
    } else {
        false
    };
    IntegrationStatus {
        client_detected: parent_exists,
        registered,
        config_path: Some(path.display().to_string()),
    }
}

fn wire_claude_desktop(binary: &Path) -> Result<PathBuf> {
    let path = claude_desktop_config_path()?;

    if let Some(parent) = path.parent() {
        if !parent.exists() {
            return Err(anyhow!(
                "Claude Desktop is not installed (no config dir at {})",
                parent.display()
            ));
        }
    }

    let mut root: Value = if path.exists() {
        let raw = std::fs::read_to_string(&path)
            .with_context(|| format!("reading {}", path.display()))?;
        if raw.trim().is_empty() {
            Value::Object(Map::new())
        } else {
            serde_json::from_str(&raw)
                .with_context(|| format!("parsing existing {}", path.display()))?
        }
    } else {
        Value::Object(Map::new())
    };

    let root_obj = root
        .as_object_mut()
        .ok_or_else(|| anyhow!("{} is not a JSON object", path.display()))?;

    let servers = root_obj
        .entry("mcpServers".to_string())
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| anyhow!("`mcpServers` in {} is not an object", path.display()))?;

    servers.insert(
        SERVER_NAME.to_string(),
        serde_json::json!({
            "command": binary.display().to_string(),
            "args": []
        }),
    );

    write_atomic(&path, &root)?;
    Ok(path)
}

// ────────────────────────────────────────────────────────────────────────
// Claude Code — `claude mcp add`
// ────────────────────────────────────────────────────────────────────────

/// Fallback when `which claude` fails because the Tauri-launched parent
/// has only the GUI default PATH (`/usr/bin:/bin:/usr/sbin:/sbin`).
fn claude_in_known_locations() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin/claude"));
        candidates.push(home.join(".claude/local/claude"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/claude"));
    candidates.push(PathBuf::from("/usr/local/bin/claude"));
    candidates.into_iter().find(|p| p.exists())
}

fn which(name: &str) -> Option<PathBuf> {
    let out = Command::new("which").arg(name).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(PathBuf::from(s))
    }
}

fn claude_code_status() -> IntegrationStatus {
    let claude = which("claude").or_else(claude_in_known_locations);
    let client_detected = claude.is_some();

    let mut registered = false;
    if let Some(c) = claude.as_ref() {
        if let Ok(out) = Command::new(c).args(["mcp", "get", SERVER_NAME]).output() {
            registered = out.status.success();
        }
    }

    IntegrationStatus {
        client_detected,
        registered,
        config_path: dirs::home_dir().map(|h| h.join(".claude.json").display().to_string()),
    }
}

fn wire_claude_code(binary: &Path) -> Result<()> {
    let claude = which("claude")
        .or_else(claude_in_known_locations)
        .ok_or_else(|| {
            anyhow!(
                "`claude` CLI not found on PATH or in ~/.local/bin, ~/.claude/local, /opt/homebrew/bin, /usr/local/bin"
            )
        })?;

    // Idempotent: remove existing entry so we can re-add with the
    // (possibly updated) binary path.
    let listing = Command::new(&claude).args(["mcp", "list"]).output();
    let already = listing
        .as_ref()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(SERVER_NAME))
        .unwrap_or(false);
    if already {
        let _ = Command::new(&claude)
            .args(["mcp", "remove", SERVER_NAME, "-s", "user"])
            .output();
    }

    let binary_str = binary
        .to_str()
        .ok_or_else(|| anyhow!("binary path is not utf-8"))?;
    let status = Command::new(&claude)
        .args(["mcp", "add", SERVER_NAME, "-s", "user", "--", binary_str])
        .status()
        .with_context(|| format!("running `{} mcp add ...`", claude.display()))?;
    if !status.success() {
        return Err(anyhow!("`claude mcp add` exited with {status}"));
    }
    Ok(())
}

// ────────────────────────────────────────────────────────────────────────
// Atomic write
// ────────────────────────────────────────────────────────────────────────

fn write_atomic(path: &Path, value: &Value) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("path has no parent: {}", path.display()))?;
    std::fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;

    let pretty = serde_json::to_string_pretty(value)?;
    let mut tmp = NamedTempFile::new_in(parent)
        .with_context(|| format!("opening tempfile in {}", parent.display()))?;
    use std::io::Write as _;
    tmp.write_all(pretty.as_bytes())?;
    tmp.write_all(b"\n")?;
    tmp.persist(path)
        .map_err(|e| anyhow!("renaming tempfile to {}: {}", path.display(), e.error))?;
    Ok(())
}
