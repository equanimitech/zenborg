//! zenborg-daemon — headless sidecar for the desktop observer and scheduler.
//!
//! Quitting zenborg doesn't kill it. launchd keeps it alive.
//!
//! ## Single-writer guard
//!
//! Advisory flocks on `<log_dir>/.scheduler.lock` and `<log_dir>/.writer.lock`.
//! A second instance exits loudly rather than doubling every event or job run.
//!
//! ## Scheduler
//!
//! Zenborg jobs live in `<vault>/jobs.json`, read once at startup — see
//! `scheduler.rs`.
//!
//! ## Vault resolution
//!
//! The daemon is a standalone binary, not a Tauri app. It cannot use
//! `cfg!(debug_assertions)` to pick between `~/.zenborg` and `~/.zenborg-dev`
//! because it is always a release build. Resolution:
//!   1. `ZENBORG_HOME` env var (if set and non-empty) — used verbatim
//!   2. `KAIROS_HOME` env var (legacy) — used verbatim
//!   3. `$HOME/.zenborg` (always release for a standalone binary)

mod assertions;
mod scheduler;
mod sensors;
mod state;

use std::fs::{self, File, OpenOptions};
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;

use anyhow::{bail, Context, Result};

use observer_core::config;
use observer_core::writer;

/// Tell macOS this process is a background agent — no Dock icon, no Cmd+Tab entry.
///
/// Must run before anything touches AppKit. `x-win` initializes `NSApplication`
/// internally; without this the default `Regular` policy applies and the daemon
/// appears alongside real apps.
#[cfg(target_os = "macos")]
fn hide_from_dock() {
    use std::ffi::c_char;

    extern "C" {
        fn objc_getClass(name: *const c_char) -> *mut std::ffi::c_void;
        fn sel_registerName(name: *const c_char) -> *mut std::ffi::c_void;
        fn objc_msgSend();
    }

    type MsgSendId = unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    type MsgSendBoolIsize = unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void, isize) -> bool;

    unsafe {
        let cls = objc_getClass(b"NSApplication\0".as_ptr() as *const c_char);
        if cls.is_null() {
            return;
        }
        let shared_app: MsgSendId = std::mem::transmute(objc_msgSend as *const ());
        let app = shared_app(cls, sel_registerName(b"sharedApplication\0".as_ptr() as *const c_char));
        if app.is_null() {
            return;
        }
        // NSApplicationActivationPolicyProhibited = 2
        let set_policy: MsgSendBoolIsize = std::mem::transmute(objc_msgSend as *const ());
        set_policy(app, sel_registerName(b"setActivationPolicy:\0".as_ptr() as *const c_char), 2);
    }
}

#[cfg(not(target_os = "macos"))]
fn hide_from_dock() {}

/// Resolve the zenborg vault root. The daemon has no debug/release split —
/// it is always a release binary. Use env vars or fall back to `~/.zenborg`.
fn vault_root() -> Result<PathBuf> {
    for key in &["ZENBORG_HOME", "KAIROS_HOME"] {
        if let Ok(raw) = std::env::var(key) {
            if !raw.trim().is_empty() {
                let path = PathBuf::from(raw);
                fs::create_dir_all(&path)?;
                return Ok(path);
            }
        }
    }
    let home = dirs::home_dir().context("could not resolve $HOME")?;
    let root = home.join(".zenborg");
    fs::create_dir_all(&root)?;
    Ok(root)
}

/// Advisory flock on `<log_dir>/<name>`. Returns the held file handle —
/// dropping it releases the lock.
fn acquire_lock(log_dir: &std::path::Path, name: &str) -> Result<File> {
    fs::create_dir_all(log_dir)?;
    let lock_path = log_dir.join(name);
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&lock_path)
        .context("could not open writer lock")?;

    use std::os::unix::io::AsRawFd;
    let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if rc != 0 {
        bail!(
            "another process holds the lock at {}. Only one daemon may run per vault.",
            lock_path.display()
        );
    }
    Ok(file)
}

fn main() -> Result<()> {
    hide_from_dock();

    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    let vault = vault_root()?;
    let keel_dir = writer::keel_dir(&vault);
    let config_json = writer::read_config(&keel_dir);
    let observer_config = config::resolve_observer_config(&config_json);

    let log_dir = keel_dir.join(&observer_config.log_dir_name);

    // The scheduler runs whether or not the observer does, so it gets its own
    // single-instance guard: two daemons would run every job twice.
    let _scheduler_lock = acquire_lock(&log_dir, ".scheduler.lock")
        .context("single-scheduler guard failed")?;
    scheduler::bootstrap(&vault);

    let _writer_lock = if observer_config.enabled {
        let lock = acquire_lock(&log_dir, ".writer.lock")
            .context("single-writer guard failed")?;
        log::info!("[daemon] writer lock acquired on {}", log_dir.display());
        let state = Arc::new(state::ObserverState::new(observer_config, keel_dir.clone()));
        sensors::start(Arc::clone(&state));
        Some(lock)
    } else {
        log::info!("[daemon] observer disabled in config — scheduler only. Set desktop.backgroundObserver.enabled: true to observe.");
        None
    };

    log::info!("[daemon] running. Send SIGTERM to stop.");

    // Park the main thread. The sensor loop and scheduler jobs run on their
    // own threads. SIGTERM from launchd will terminate the process; the flock
    // releases automatically.
    loop {
        thread::park();
    }
}
