//! Sensor wiring — adapted from the app's sensors.rs.
//!
//! Tauri state replaced with Arc<ObserverState>, app.emit() with log::warn!.

use std::collections::BTreeMap;
use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::json;
use user_idle::UserIdle;
use x_win::get_active_window;

use observer_core::config;
use observer_core::domain::{self, IdleTransition};
use observer_core::writer;

use crate::assertions::{self, HoldTransition};
use crate::state::ObserverState;

const POLL_INTERVAL: Duration = Duration::from_millis(1500);
const INPUT_POLLS_PER_BIN: usize = 2;
const INPUT_POLLS_PER_ROLLUP: usize = 20;
const INPUT_BIN_MS: u64 = 3_000;
/// Power assertions and the screen lock are sampled every 10 polls (15 s):
/// one `pmset` spawn per sample, cheap enough, and a film is hours long.
const HOLD_POLLS_PER_SAMPLE: usize = 10;

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceCounterForEventType(state_id: u32, event_type: u32) -> u32;
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
    fn CGSessionCopyCurrentDictionary() -> *const std::ffi::c_void;
}

#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFDictionaryGetValue(
        dict: *const std::ffi::c_void,
        key: *const std::ffi::c_void,
    ) -> *const std::ffi::c_void;
    fn CFStringCreateWithCString(
        alloc: *const std::ffi::c_void,
        c_str: *const std::ffi::c_char,
        encoding: u32,
    ) -> *const std::ffi::c_void;
    fn CFRelease(cf: *const std::ffi::c_void);
}

/// True while the login window covers the session. The session dictionary
/// carries `CGSSessionScreenIsLocked` only while locked.
#[cfg(target_os = "macos")]
fn screen_locked() -> bool {
    const UTF8: u32 = 0x0800_0100;
    unsafe {
        let session = CGSessionCopyCurrentDictionary();
        if session.is_null() {
            return false;
        }
        let key =
            CFStringCreateWithCString(std::ptr::null(), c"CGSSessionScreenIsLocked".as_ptr(), UTF8);
        let locked = !key.is_null() && !CFDictionaryGetValue(session, key).is_null();
        if !key.is_null() {
            CFRelease(key);
        }
        CFRelease(session);
        locked
    }
}

#[cfg(not(target_os = "macos"))]
fn screen_locked() -> bool {
    false
}

/// Apps holding the Mac awake right now. An unreadable `pmset` reads as none.
// ponytail: one process spawn per sample; IOPMCopyAssertionsByProcess if 15 s ever costs too much.
fn current_holds() -> std::collections::BTreeSet<assertions::Hold> {
    Command::new("/usr/bin/pmset")
        .args(["-g", "assertions"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| assertions::parse_holds(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
const HID_SYSTEM_STATE: u32 = 1;
#[cfg(target_os = "macos")]
const ET_LEFT_MOUSE_DOWN: u32 = 1;
#[cfg(target_os = "macos")]
const ET_MOUSE_MOVED: u32 = 5;
#[cfg(target_os = "macos")]
const ET_KEY_DOWN: u32 = 10;
#[cfg(target_os = "macos")]
const ET_SCROLL_WHEEL: u32 = 22;

#[cfg(target_os = "macos")]
fn read_input_counters() -> [u32; 4] {
    unsafe {
        [
            CGEventSourceCounterForEventType(HID_SYSTEM_STATE, ET_KEY_DOWN),
            CGEventSourceCounterForEventType(HID_SYSTEM_STATE, ET_LEFT_MOUSE_DOWN),
            CGEventSourceCounterForEventType(HID_SYSTEM_STATE, ET_SCROLL_WHEEL),
            CGEventSourceCounterForEventType(HID_SYSTEM_STATE, ET_MOUSE_MOVED),
        ]
    }
}

#[cfg(not(target_os = "macos"))]
fn read_input_counters() -> [u32; 4] {
    [0; 4]
}

#[cfg(target_os = "macos")]
fn screen_recording_granted() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}

#[cfg(not(target_os = "macos"))]
fn screen_recording_granted() -> bool {
    true
}

#[cfg(target_os = "macos")]
fn request_screen_recording() {
    unsafe {
        CGRequestScreenCaptureAccess();
    }
}

#[cfg(not(target_os = "macos"))]
fn request_screen_recording() {}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn input_sensor_opted_in(state: &ObserverState) -> bool {
    let config_json = writer::read_config(&state.keel_dir);
    domain::input_sensor_enabled(&config_json)
}

fn emit(state: &ObserverState, kind: &str, ts: u64, payload: serde_json::Value, duration_ms: Option<u64>) {
    let file = domain::local_log_file_name(ts);
    let event = domain::build_event(
        uuid::Uuid::new_v4().to_string(),
        kind,
        ts,
        payload,
        duration_ms,
    );
    if let Some(line) = domain::event_line(&event) {
        let _ = writer::append_line(&state.log_dir, &file, &line);
    }
}

fn emit_holds(state: &ObserverState, transitions: Vec<HoldTransition>, now: u64) {
    for t in transitions {
        let (kind, (app, name), duration_ms) = match t {
            HoldTransition::Start(hold) => ("wake_held_start", hold, None),
            HoldTransition::End { hold, duration_ms } => ("wake_held_end", hold, Some(duration_ms)),
        };
        emit(
            state,
            kind,
            now,
            json!({ "app_name": app, "assertion": name }),
            duration_ms,
        );
    }
}

fn check_paused(state: &ObserverState) -> bool {
    let config_json = writer::read_config(&state.keel_dir);
    let config = config::parse_observer_config(&config_json);
    !config.enabled
}

/// Start the sensor loop. Returns whether it started.
pub fn start(state: Arc<ObserverState>) -> bool {
    if !state.config.enabled {
        log::info!("[observer] disabled — not starting");
        return false;
    }
    if state.running.swap(true, Ordering::SeqCst) {
        return true;
    }

    log::info!("[observer] writing to {}", state.log_dir.display());

    emit(
        &state,
        "writer_started",
        now_ms(),
        json!({ "appVersion": env!("CARGO_PKG_VERSION") }),
        None,
    );

    if !screen_recording_granted() {
        request_screen_recording();
        if !state.permission_needed.swap(true, Ordering::SeqCst) {
            log::warn!(
                "[observer] Screen Recording not granted — window titles will log as empty. \
                 Grant it in System Settings › Privacy & Security › Screen Recording, then relaunch."
            );
        }
    }

    spawn_loop(state);
    true
}

fn spawn_loop(state: Arc<ObserverState>) {
    thread::spawn(move || {
        let mut last_focus: Option<(String, String)> = None;
        let mut focus_since: Option<u64> = None;
        let mut idle_since: Option<u64> = None;
        let mut input_enabled = input_sensor_opted_in(&state);
        let mut input_prev: Option<[u32; 4]> = None;
        let mut input_deltas: Vec<[u64; 4]> = Vec::new();
        let mut ticks: usize = 0;
        let mut holds: BTreeMap<assertions::Hold, u64> = BTreeMap::new();
        let mut locked = false;

        loop {
            thread::sleep(POLL_INTERVAL);

            if state.paused.load(Ordering::SeqCst) || check_paused(&state) {
                last_focus = None;
                focus_since = None;
                idle_since = None;
                input_prev = None;
                input_deltas.clear();
                // Close open holds so none spans the pause.
                let at = now_ms();
                let released = assertions::hold_transitions(&mut holds, Default::default(), at);
                emit_holds(&state, released, at);
                locked = false;
                continue;
            }

            let now = now_ms();
            ticks = ticks.wrapping_add(1);

            if ticks % INPUT_POLLS_PER_ROLLUP == 0 {
                input_enabled = input_sensor_opted_in(&state);
            }
            if input_enabled {
                let counters = read_input_counters();
                if let Some(prev) = input_prev {
                    input_deltas.push([
                        domain::counter_delta(prev[0], counters[0]),
                        domain::counter_delta(prev[1], counters[1]),
                        domain::counter_delta(prev[2], counters[2]),
                        domain::counter_delta(prev[3], counters[3]),
                    ]);
                }
                input_prev = Some(counters);
                if input_deltas.len() >= INPUT_POLLS_PER_ROLLUP {
                    let window_ms = input_deltas.len() as u64 * POLL_INTERVAL.as_millis() as u64;
                    let bins = domain::fold_into_bins(&input_deltas, INPUT_POLLS_PER_BIN);
                    if let Some(payload) = domain::input_rollup(&bins, INPUT_BIN_MS) {
                        emit(&state, "input_activity", now, payload, Some(window_ms));
                    }
                    input_deltas.clear();
                }
            } else {
                input_prev = None;
                input_deltas.clear();
            }

            if ticks % HOLD_POLLS_PER_SAMPLE == 0 {
                // A lock ends any idle credit; it reads like the browser's
                // chrome.idle "locked" state, so both surfaces say it one way.
                let now_locked = screen_locked();
                if now_locked && !locked {
                    emit(
                        &state,
                        "idle_start",
                        now,
                        json!({ "state": "locked" }),
                        None,
                    );
                }
                locked = now_locked;

                let transitions = assertions::hold_transitions(&mut holds, current_holds(), now);
                emit_holds(&state, transitions, now);
            }

            if let Ok(idle) = UserIdle::get_time() {
                let idle_ms = idle.as_milliseconds() as u64;
                let (next, transition) =
                    domain::idle_transition(idle_since, now, idle_ms, domain::IDLE_THRESHOLD_MS);
                idle_since = next;
                match transition {
                    Some(IdleTransition::Start { ts }) => {
                        emit(
                            &state,
                            "idle_start",
                            ts,
                            json!({ "thresholdMs": domain::IDLE_THRESHOLD_MS }),
                            None,
                        );
                    }
                    Some(IdleTransition::End { ts, duration_ms }) => {
                        emit(&state, "idle_end", ts, json!({}), Some(duration_ms));
                    }
                    None => {}
                }
            }

            match get_active_window() {
                Ok(active) => {
                    if screen_recording_granted() {
                        state.permission_needed.store(false, Ordering::SeqCst);
                    }
                    let app_name = active.info.name.clone();
                    let title = domain::cap_title(&active.title, domain::TITLE_CAP);
                    if domain::focus_changed(last_focus.as_ref(), &app_name, &title) {
                        emit(
                            &state,
                            "app_switched",
                            now,
                            domain::app_switch_payload(
                                &app_name,
                                &title,
                                active.position.is_full_screen,
                            ),
                            domain::switch_duration(focus_since, now),
                        );
                        last_focus = Some((app_name, title));
                        focus_since = Some(now);
                    }
                }
                Err(_) => {
                    if !state.permission_needed.swap(true, Ordering::SeqCst) {
                        log::warn!("[observer] Screen Recording not granted");
                    }
                }
            }
        }
    });
}
