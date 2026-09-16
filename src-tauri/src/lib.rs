mod daemon_install;
mod login_item;
mod mcp_install;
mod native_host_install;
mod observer;
mod scheduler;
mod vault;

use observer::{ObserverConfig, ObserverState};
use std::path::PathBuf;
use tauri::Manager;
use vault::VaultState;

fn sidecar_path(name: &str) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "current exe has no parent dir".to_string())?;
    let candidate = dir.join(name);
    if !candidate.exists() {
        return Err(format!(
            "bundled {} not present next to app exe ({})",
            name,
            dir.display()
        ));
    }
    Ok(candidate)
}

/// The window zenborg opens. Named here because background mode has to find it
/// again to hide it.
const MAIN_WINDOW: &str = "main";

#[tauri::command]
fn mcp_integrations_status() -> mcp_install::IntegrationsStatus {
    mcp_install::status()
}

#[tauri::command]
fn daemon_status() -> daemon_install::DaemonStatus {
    daemon_install::status()
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
    // Resolved before the builder so the window policy and the observer read
    // the same document exactly once.
    let observer_config: ObserverConfig = observer::resolve_config();
    let background = observer_config.enabled;
    let start_hidden = observer_config.start_hidden;

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .manage(VaultState::new())
        .manage(ObserverState::new(observer_config))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(feature = "e2e-testing")]
    {
        builder = builder.plugin(tauri_plugin_playwright::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            vault::vault_read_collection,
            vault::vault_write_collection,
            vault::vault_root_path,
            vault::vault_nudge,
            mcp_integrations_status,
            rewire_mcp_integrations,
            daemon_status,
            observer::observer_status,
            observer::observer_set_paused,
            login_item::login_item_status,
            login_item::login_item_register,
            login_item::login_item_unregister,
        ])
        .setup(move |app| {
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

            // ── Background mode ──────────────────────────────────
            //
            // Migration steps 3 and 4 of "the garden absorbs keel". The
            // desktop activity writer and the two schedules that were three
            // launchd agents now belong to this process. Both are off unless
            // the keel config says otherwise, because `apps/tray` and the
            // plists are not retired until step 6 and two writers on one
            // collection would double every event.
            observer::bootstrap(app.handle());
            scheduler::bootstrap();

            if background {
                // Closing the window stops being quitting. The observer's
                // whole value is uptime, and a writer that dies when you tidy
                // your desktop is the failure the tray's launchd agent was
                // written to end. Cmd-Q still quits — the exit stays reachable,
                // which is the invariant this system does not trade away.
                if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                    let hidden = window.clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = hidden.hide();
                        }
                    });
                    if start_hidden {
                        let _ = window.hide();
                    }
                }
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
                    if let Err(e) = daemon_install::install_once_per_version(&app_version) {
                        log::info!("[daemon] wiring skipped: {e}");
                    }
                    match crate::sidecar_path("zenborg-native-host") {
                        Ok(path) => {
                            if let Err(e) = native_host_install::install(&path) {
                                log::info!("[native-host] manifest install skipped: {e}");
                            }
                        }
                        Err(e) => log::info!("[native-host] sidecar not found: {e}"),
                    }
                });
            }

            // Launch the bundled zenborg-calendar sidecar in watch mode.
            // It owns EventKit and writes the vault directly; the watcher
            // above picks up its writes. Failure to spawn degrades to
            // "no sync", never to a broken app.
            let sidecar_enabled = !cfg!(debug_assertions)
                || std::env::var("ZENBORG_CALENDAR_SIDECAR").as_deref() == Ok("1");
            if sidecar_enabled {
                match sidecar_path("zenborg-calendar") {
                    Ok(bin) => {
                        match std::process::Command::new(bin).arg("run").spawn() {
                            Ok(child) => {
                                let pid = child.id();
                                log::info!("[calendar] sidecar spawned (pid {})", pid);
                                // Store the child so we can kill it on exit
                                app.manage(CalendarSidecarChild(std::sync::Mutex::new(Some(child))));
                            }
                            Err(e) => log::warn!("[calendar] sidecar failed to spawn: {e}"),
                        }
                    }
                    Err(e) => log::info!("[calendar] sidecar not present: {e}"),
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

struct CalendarSidecarChild(std::sync::Mutex<Option<std::process::Child>>);
impl Drop for CalendarSidecarChild {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(ref mut child) = *guard {
                let _ = child.kill();
            }
        }
    }
}
