//! Zenborg vault — file-based source of truth for domain collections.
//!
//! The vault lives at $HOME/.zenborg/ and contains one JSON file per collection.
//! It is the persistent truth across sessions and devices; IndexedDB acts as
//! a hot runtime cache synchronized via Legend State's `synced()` adapter.
//!
//! Architecture:
//!   TS synced() adapter
//!       ↓  invoke("vault_read_collection" | "vault_write_collection")
//!   Tauri commands (this module)
//!       ↓
//!   fs.rs (atomic read/write)  ←  watcher.rs (notify → frontend events)
//!       ↓
//!   SelfWriteTracker (suppresses echo from our own writes)

pub mod fs;
pub mod watcher;
pub mod write_tracker;

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};

use self::fs::{read_collection, vault_root, write_collection};
use self::write_tracker::SelfWriteTracker;

/// Managed state — shared SelfWriteTracker across commands and watcher.
pub struct VaultState {
    pub tracker: Arc<SelfWriteTracker>,
}

impl VaultState {
    pub fn new() -> Self {
        Self {
            tracker: Arc::new(SelfWriteTracker::new()),
        }
    }
}

impl Default for VaultState {
    fn default() -> Self {
        Self::new()
    }
}

// ────────────────────────────────────────────────────────────────────────
// Tauri commands
// ────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn vault_read_collection(collection: String) -> Result<Option<String>, String> {
    read_collection(&collection)
}

#[tauri::command]
pub fn vault_write_collection(
    collection: String,
    json: String,
    state: State<'_, VaultState>,
) -> Result<(), String> {
    write_collection(&collection, &json, &state.tracker)
}

#[tauri::command]
pub fn vault_root_path() -> Result<String, String> {
    vault_root().map(|p| p.to_string_lossy().to_string())
}

/// Force-emit `vault:collection-changed` for every collection file that exists.
/// Used by the "Sync now" button when the FSEvents watcher has gone silent.
#[tauri::command]
pub fn vault_nudge(app: AppHandle) -> Result<u32, String> {
    let root = vault_root()?;
    let mut count = 0u32;
    for name in fs::ALLOWED_COLLECTIONS {
        let path = root.join(format!("{}.json", name));
        if path.exists() {
            let _ = app.emit(
                "vault:collection-changed",
                watcher::VaultChangeEvent {
                    collection: name.to_string(),
                    change_type: "modified".to_string(),
                },
            );
            count += 1;
        }
    }
    Ok(count)
}

// ────────────────────────────────────────────────────────────────────────
// Bootstrap — called from lib.rs setup hook
// ────────────────────────────────────────────────────────────────────────

/// Start the vault watcher. Must be called after the app is built so we
/// have an AppHandle for emitting events.
pub fn bootstrap(app: &AppHandle) -> Result<(), String> {
    let root = vault_root()?;
    // Log the active vault so mis-pointed dev sessions are instantly visible.
    let mode = if cfg!(debug_assertions) { "dev" } else { "release" };
    println!("[vault] mode={} root={}", mode, root.display());
    let state = app.state::<VaultState>();
    watcher::start_watcher(app.clone(), root, Arc::clone(&state.tracker))
}
