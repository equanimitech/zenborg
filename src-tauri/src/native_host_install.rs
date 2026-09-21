//! Register the native messaging manifest for Chromium browsers on app launch.
//!
//! Each Chromium browser looks for manifests in its own well-known directory.
//! We write to Chrome and Brave on every launch (200 bytes each, idempotent)
//! so moves and updates just work.

use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};

const HOST_NAME: &str = "tech.equanimi.zenborg";

/// Derived from the pinned public key in `extension/wxt.config.ts`.
/// Stable across dev reloads because the key is committed.
const EXTENSION_ID: &str = "nhgfgpkpdcfmlcodnebehcljdnlfpamo";

fn manifest_dirs() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return vec![];
    };
    vec![
        home.join("Library/Application Support/Google/Chrome/NativeMessagingHosts"),
        home.join("Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
    ]
}

/// Write the native messaging manifest pointing at the bundled sidecar.
///
/// Called from the Tauri setup hook. Installs to every known Chromium browser
/// directory. Fails soft — a missing manifest means the extension buffers
/// events in IndexedDB until the next successful install.
pub fn install(sidecar_path: &std::path::Path) -> Result<()> {
    let dirs = manifest_dirs();
    if dirs.is_empty() {
        anyhow::bail!("could not resolve home directory");
    }

    let manifest = serde_json::json!({
        "name": HOST_NAME,
        "description": "zenborg browser extension relay",
        "path": sidecar_path.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [
            format!("chrome-extension://{EXTENSION_ID}/"),
        ]
    });
    let body = serde_json::to_string_pretty(&manifest)?;
    let filename = format!("{HOST_NAME}.json");

    for dir in &dirs {
        if let Err(e) = fs::create_dir_all(dir) {
            log::warn!("[native-host] skipping {}: {e}", dir.display());
            continue;
        }
        let file = dir.join(&filename);
        match fs::write(&file, &body) {
            Ok(()) => log::info!(
                "[native-host] manifest installed: {} → {}",
                file.display(),
                sidecar_path.display()
            ),
            Err(e) => log::warn!("[native-host] failed to write {}: {e}", file.display()),
        }
    }

    Ok(())
}
