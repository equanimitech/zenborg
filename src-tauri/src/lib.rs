mod mcp_install;
mod vault;

use vault::VaultState;

#[tauri::command]
fn mcp_integrations_status() -> mcp_install::IntegrationsStatus {
    mcp_install::status()
}

#[tauri::command]
async fn rewire_mcp_integrations() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        mcp_install::install_all()
            .map(|p| p.display().to_string())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(VaultState::new())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            vault::vault_read_collection,
            vault::vault_write_collection,
            vault::vault_root_path,
            mcp_integrations_status,
            rewire_mcp_integrations,
        ])
        .setup(|app| {
            // Global shortcuts (desktop only)
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_global_shortcut::Builder::new().build())?;

            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .targets([
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                            file_name: None,
                        }),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                    ])
                    .build(),
            )?;

            // Start vault watcher (fires `vault:collection-changed` events)
            if let Err(e) = vault::bootstrap(app.handle()) {
                log::warn!("[vault] Failed to start watcher: {}", e);
            }

            // Auto-wire the bundled `zenborg-mcp` sidecar into Claude
            // Desktop + Claude Code. Idempotent and gated on a marker
            // file: re-runs only when the bundled binary path or app
            // version changes. Spawned blocking because both wirings
            // touch the filesystem and may shell out to `claude`.
            //
            // Debug builds skip auto-wiring — `target/debug/bundle/...`
            // paths get wiped on `cargo clean`, which would leave the
            // user's production wire pointing at a deleted binary. The
            // Settings UI still exposes `rewire_mcp_integrations` for
            // manual triggering from dev.
            if !cfg!(debug_assertions) {
                let app_version = app.package_info().version.to_string();
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(e) = mcp_install::install_once_per_version(&app_version) {
                        log::info!("[mcp] wiring skipped: {e}");
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
