//! Filesystem operations for the zenborg vault.
//!
//! Layout:
//!   $HOME/.zenborg/            (release builds)
//!   $HOME/.zenborg-dev/        (debug builds — prevents dev from trashing prod)
//!   $ZENBORG_HOME              (explicit override — wins over both defaults)
//!   $KAIROS_HOME               (legacy override — honoured after ZENBORG_HOME)
//!     ├── moments.json
//!     ├── areas.json
//!     ├── habits.json
//!     ├── cycles.json
//!     ├── cyclePlans.json
//!     ├── phaseConfigs.json
//!     ├── metricLogs.json
//!     ├── dayNotes.json
//!     ├── people.json
//!     ├── places.json
//!     └── relationships.json
//!
//! Writes use temp-file-then-rename for atomicity on the same filesystem.

use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::vault::write_tracker::SelfWriteTracker;

/// Env vars that, if set, override the default vault location entirely.
/// Useful for tests, scratch vaults, or pointing at a synced folder.
///
/// `ZENBORG_HOME` is the canonical name. `KAIROS_HOME` is honoured after it
/// so existing shells and test setups keep working; an empty value falls
/// through rather than resolving to the current directory.
const VAULT_DIR_ENVS: &[&str] = &["ZENBORG_HOME", "KAIROS_HOME"];

/// Allowed vault file names (without `.json`). Hardcoded to prevent path traversal.
///
/// `activeMoment` is the odd one out: a singleton pointer (`{momentId, at}`)
/// naming the moment that IS the current intention, not a collection keyed by
/// UUID. It rides these generic commands anyway — the Rust side only ever moves
/// opaque JSON strings — and listing it here is also what lets the watcher emit
/// change events for it, so the app follows a pointer the MCP server wrote.
/// It is deliberately absent from `DomainModelRegistry` on the TS side, where
/// the record-of-UUID shape does matter.
pub const ALLOWED_COLLECTIONS: &[&str] = &[
    "moments",
    "areas",
    "habits",
    "cycles",
    "cyclePlans",
    "phaseConfigs",
    "metricLogs",
    "dayNotes",
    "people",
    "places",
    "relationships",
    "routines",
    "activeMoment",
];

fn validate_collection(name: &str) -> Result<(), String> {
    if ALLOWED_COLLECTIONS.contains(&name) {
        Ok(())
    } else {
        Err(format!("Unknown collection: {}", name))
    }
}

/// Folder name inside $HOME for the default vault location.
///
/// Debug builds use `.zenborg-dev` so that running `pnpm dev:desktop`
/// against a locally-installed production app does NOT pollute the
/// user's real vault. Release builds use `.zenborg`.
const fn default_vault_folder() -> &'static str {
    if cfg!(debug_assertions) {
        ".zenborg-dev"
    } else {
        ".zenborg"
    }
}

/// Returns the vault root, creating it if missing.
///
/// Resolution order:
///   1. `ZENBORG_HOME` env var (if set and non-empty) — used verbatim
///   2. `KAIROS_HOME` env var (legacy, same rule) — used verbatim
///   3. `$HOME/.zenborg-dev` in debug builds
///   4. `$HOME/.zenborg` in release builds
pub fn vault_root() -> Result<PathBuf, String> {
    let override_dir = VAULT_DIR_ENVS.iter().find_map(|key| match env::var(key) {
        Ok(raw) if !raw.trim().is_empty() => Some(PathBuf::from(raw)),
        _ => None,
    });
    let root = match override_dir {
        Some(dir) => dir,
        None => {
            let home =
                dirs::home_dir().ok_or_else(|| "Could not resolve $HOME".to_string())?;
            home.join(default_vault_folder())
        }
    };
    fs::create_dir_all(&root)
        .map_err(|e| format!("Failed to create vault dir {}: {}", root.display(), e))?;
    Ok(root)
}

fn collection_path(collection: &str) -> Result<PathBuf, String> {
    validate_collection(collection)?;
    Ok(vault_root()?.join(format!("{}.json", collection)))
}

/// Read a collection as a JSON string. Returns `None` if the file doesn't exist.
pub fn read_collection(collection: &str) -> Result<Option<String>, String> {
    let path = collection_path(collection)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))
}

/// Write a collection atomically: write to `.tmp` then rename.
/// Stamps the path in the SelfWriteTracker so the watcher ignores the event.
pub fn write_collection(
    collection: &str,
    json: &str,
    tracker: &Arc<SelfWriteTracker>,
) -> Result<(), String> {
    let path = collection_path(collection)?;
    let tmp_path = path.with_extension("json.tmp");

    // Register before the write so the watcher suppresses FSEvents that
    // arrive even slightly before we return.
    tracker.register_write(path.to_string_lossy().as_ref());

    let mut file = fs::File::create(&tmp_path)
        .map_err(|e| format!("Failed to create {}: {}", tmp_path.display(), e))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("Failed to write {}: {}", tmp_path.display(), e))?;
    file.sync_all()
        .map_err(|e| format!("Failed to fsync {}: {}", tmp_path.display(), e))?;
    drop(file);

    fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to rename {} -> {}: {}", tmp_path.display(), path.display(), e))?;

    Ok(())
}

/// Extract the collection name from a vault file path (e.g. "moments.json" -> "moments").
/// Returns None if the path isn't a recognized collection file.
pub fn collection_from_path(path: &Path) -> Option<String> {
    let file_name = path.file_name()?.to_str()?;
    let stem = file_name.strip_suffix(".json")?;
    if ALLOWED_COLLECTIONS.contains(&stem) {
        Some(stem.to_string())
    } else {
        None
    }
}
