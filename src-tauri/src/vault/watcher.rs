//! File watcher — emits events to the frontend when collection files
//! are modified externally (outside the self-write suppression window).
//!
//! Inspired by penceive/src-tauri/src/infrastructure/watcher.rs.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc;

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::fs::collection_from_path;
use super::write_tracker::SelfWriteTracker;

#[derive(Serialize, Clone)]
pub struct VaultChangeEvent {
    pub collection: String,
    pub change_type: String,
}

/// Start the vault file watcher on a background thread.
///
/// Emits "vault:collection-changed" events to the frontend when collection
/// files are modified by something other than zenborg itself.
pub fn start_watcher(
    app: AppHandle,
    vault_path: PathBuf,
    write_tracker: Arc<SelfWriteTracker>,
) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();

    let mut watcher = RecommendedWatcher::new(tx, Config::default())
        .map_err(|e| format!("Failed to create vault watcher: {}", e))?;

    watcher
        .watch(&vault_path, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch vault: {}", e))?;

    std::thread::spawn(move || {
        let _watcher = watcher; // prevent drop
        for result in rx {
            let event = match result {
                Ok(e) => e,
                Err(_) => continue,
            };

            for change in external_changes(&event, &write_tracker) {
                let _ = app.emit("vault:collection-changed", change);
            }
        }
    });

    Ok(())
}

/// The collection changes in one notify event that came from someone other
/// than this app. Writers (the app and the MCP server) both land a file by
/// temp-file + rename, which arrives as `Modify(Name)` on the final path.
fn external_changes(event: &Event, write_tracker: &SelfWriteTracker) -> Vec<VaultChangeEvent> {
    let change_type = match event.kind {
        EventKind::Create(_) => "added",
        EventKind::Modify(_) => "modified",
        EventKind::Remove(_) => "deleted",
        _ => return Vec::new(),
    };

    event
        .paths
        .iter()
        .filter_map(|path| {
            let collection = collection_from_path(path)?;
            // Suppress echoes of our own writes: the file still holds exactly
            // the bytes we wrote. A missing file reads as empty and is reported.
            let current = std::fs::read(path).unwrap_or_default();
            if write_tracker.is_self_write(&collection, &current) {
                return None;
            }
            Some(VaultChangeEvent {
                collection,
                change_type: change_type.to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{Duration, Instant};

    /// Drive the real OS watcher on a temp vault and collect what would be
    /// emitted to the frontend.
    fn emitted_within(
        rx: &mpsc::Receiver<notify::Result<Event>>,
        tracker: &SelfWriteTracker,
        wait: Duration,
    ) -> Vec<String> {
        let deadline = Instant::now() + wait;
        let mut out = Vec::new();
        while let Some(left) = deadline.checked_duration_since(Instant::now()) {
            match rx.recv_timeout(left) {
                Ok(Ok(event)) => out.extend(
                    external_changes(&event, tracker)
                        .into_iter()
                        .map(|c| c.collection),
                ),
                Ok(Err(_)) => {}
                Err(_) => break,
            }
        }
        out
    }

    /// How the MCP server writes (mcp-server/vault.ts): temp file, then rename.
    fn mcp_write(root: &std::path::Path, collection: &str, json: &str) {
        let file = root.join(format!("{}.json", collection));
        let tmp = root.join(format!("{}.json.tmp-4242-{}", collection, json.len()));
        fs::write(&tmp, json).unwrap();
        fs::rename(&tmp, &file).unwrap();
    }

    /// How the app writes (fs::write_collection): register, temp file, rename.
    fn app_write(root: &std::path::Path, tracker: &SelfWriteTracker, collection: &str, json: &str) {
        tracker.register_write(collection, json.as_bytes());
        let file = root.join(format!("{}.json", collection));
        let tmp = file.with_extension("json.tmp");
        fs::write(&tmp, json).unwrap();
        fs::rename(&tmp, &file).unwrap();
    }

    #[test]
    fn mcp_write_right_after_an_app_write_reaches_the_frontend() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        fs::write(root.join("moments.json"), "{}").unwrap();

        let (tx, rx) = mpsc::channel();
        let mut watcher = RecommendedWatcher::new(tx, Config::default()).unwrap();
        watcher.watch(&root, RecursiveMode::NonRecursive).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        let _ = emitted_within(&rx, &SelfWriteTracker::new(), Duration::from_millis(200));

        let tracker = SelfWriteTracker::new();
        app_write(
            &root,
            &tracker,
            "moments",
            r#"{"m1":{"status":"accepted"}}"#,
        );
        assert_eq!(
            emitted_within(&rx, &tracker, Duration::from_millis(700)),
            Vec::<String>::new(),
            "the app's own write must not bounce back"
        );

        // #208: well inside the old 3 s suppression window.
        mcp_write(&root, "moments", r#"{"m1":{"status":"tentative"}}"#);
        let emitted = emitted_within(&rx, &tracker, Duration::from_millis(1500));
        assert!(
            emitted.iter().any(|c| c == "moments"),
            "MCP write was swallowed; emitted: {:?}",
            emitted
        );
    }
}
