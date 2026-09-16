//! Chrome native messaging host for the zenborg browser extension.
//!
//! Chrome spawns this on demand when the extension opens a native messaging
//! connection. Reads from stdin, writes to stdout, both framed with Chrome's
//! native messaging protocol (uint32 LE length prefix + UTF-8 JSON, 1MB max).
//!
//! The host stays alive as long as the extension keeps the port open. A file
//! watcher on `fences.json` pushes changes immediately rather than waiting for
//! the extension to poll.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use chrono::{Local, Timelike, TimeZone};
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{json, Value};

use observer_core::writer;

const MAX_MESSAGE_SIZE: u32 = 1_048_576; // 1MB
const DAY_START_HOUR: u32 = 4;
const EVENT_CHUNK_SIZE: usize = 500;

// ── Vault resolution ────────────────────────────────────────────────────

fn vault_root() -> PathBuf {
    for key in &["KAIROS_HOME", "ZENBORG_VAULT_DIR"] {
        if let Ok(raw) = std::env::var(key) {
            if !raw.trim().is_empty() {
                return PathBuf::from(raw);
            }
        }
    }
    dirs::home_dir()
        .map(|h| h.join(".zenborg"))
        .expect("could not resolve $HOME")
}

fn read_json(path: &Path) -> Value {
    match fs::read_to_string(path) {
        Ok(s) if !s.trim().is_empty() => serde_json::from_str(&s).unwrap_or(Value::Object(Default::default())),
        _ => Value::Object(Default::default()),
    }
}

fn read_collection(root: &Path, name: &str) -> Value {
    read_json(&root.join(format!("{name}.json")))
}

// ── Native messaging protocol ───────────────────────────────────────────

fn read_message() -> Option<Value> {
    let mut header = [0u8; 4];
    if io::stdin().read_exact(&mut header).is_err() {
        return None;
    }
    let length = u32::from_le_bytes(header);
    if length == 0 || length > MAX_MESSAGE_SIZE {
        return None;
    }
    let mut body = vec![0u8; length as usize];
    if io::stdin().read_exact(&mut body).is_err() {
        return None;
    }
    serde_json::from_slice(&body).ok()
}

fn write_message(msg: &Value) {
    let body = serde_json::to_vec(msg).unwrap_or_default();
    let header = (body.len() as u32).to_le_bytes();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    let _ = out.write_all(&header);
    let _ = out.write_all(&body);
    let _ = out.flush();
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn today_str() -> String {
    let now = Local::now();
    let date = if now.hour() < DAY_START_HOUR {
        now.date_naive() - chrono::Duration::days(1)
    } else {
        now.date_naive()
    };
    date.format("%Y-%m-%d").to_string()
}

fn local_date(ts_ms: i64) -> String {
    chrono::Local
        .timestamp_millis_opt(ts_ms)
        .single()
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| today_str())
}

fn current_phase(configs: &Value) -> &'static str {
    let hour = Local::now().hour();
    if let Value::Object(map) = configs {
        for cfg in map.values() {
            let start = cfg.get("startHour").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let end = cfg.get("endHour").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let phase = cfg.get("phase").and_then(|v| v.as_str()).unwrap_or("");
            let matches = if start <= end {
                hour >= start && hour < end
            } else {
                hour >= start || hour < end
            };
            if matches {
                return match phase {
                    "MORNING" => "MORNING",
                    "AFTERNOON" => "AFTERNOON",
                    "EVENING" => "EVENING",
                    "NIGHT" => "NIGHT",
                    _ => "MORNING",
                };
            }
        }
    }
    "MORNING"
}

fn browser_domains(scope: &Value) -> Vec<String> {
    if scope.get("surface").and_then(|v| v.as_str()) != Some("browser") {
        return vec![];
    }
    match scope.get("domain") {
        Some(Value::String(d)) => vec![d.clone()],
        Some(Value::Array(arr)) => arr.iter().filter_map(|v| v.as_str().map(String::from)).collect(),
        _ => vec![],
    }
}

fn extract_transforms(primitives: &Value, rule_id: &str, domains: &[String]) -> Vec<Value> {
    let arr = match primitives.as_array() {
        Some(a) => a,
        None => return vec![],
    };
    let mut out = Vec::new();
    for p in arr {
        let kind = p.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        if kind == "transform" {
            let replacement = match p.get("replacement").and_then(|r| r.get("type")).and_then(|t| t.as_str()) {
                Some("template") => json!({"type": "hide"}),
                _ => p.get("replacement").cloned().unwrap_or(json!({"type": "hide"})),
            };
            out.push(json!({
                "ruleId": rule_id,
                "domains": domains,
                "targets": p.get("targets"),
                "replacement": replacement,
            }));
        } else if kind == "schedule" {
            if let Some(wraps) = p.get("wraps") {
                out.extend(extract_transforms(&json!([wraps]), rule_id, domains));
            }
        }
    }
    out
}

fn hostname_from_url(url: &str) -> Option<String> {
    let rest = url.split("://").nth(1)?;
    let host_port = rest.split('/').next()?;
    let host = host_port.split(':').next()?;
    if host.is_empty() { None } else { Some(host.to_lowercase()) }
}

// ── Handlers ────────────────────────────────────────────────────────────

fn handle_events(msg: &Value, vault: &Path) {
    let events = match msg.get("events").and_then(|v| v.as_array()) {
        Some(e) => e,
        None => {
            write_message(&json!({"type": "ack", "ids": []}));
            return;
        }
    };

    let log_dir = vault.join("log");
    let mut ids: Vec<&str> = Vec::new();
    let mut by_date: HashMap<String, Vec<String>> = HashMap::new();

    for event in events {
        if event.get("surface").and_then(|v| v.as_str()) != Some("browser") {
            continue;
        }
        let id = match event.get("id").and_then(|v| v.as_str()) {
            Some(id) => id,
            None => continue,
        };
        let ts = match event.get("ts").and_then(|v| v.as_i64()) {
            Some(ts) => ts,
            None => continue,
        };

        ids.push(id);
        let date = local_date(ts);
        let line = serde_json::to_string(event).unwrap_or_default() + "\n";
        by_date.entry(date).or_default().push(line);
    }

    for (date, lines) in &by_date {
        let file_name = format!("{date}.browser.jsonl");
        let content = lines.join("");
        writer::append_line(&log_dir, &file_name, &content);
    }

    write_message(&json!({"type": "ack", "ids": ids}));
}

fn handle_request_fences(vault: &Path) {
    let fences = read_json(&vault.join("fences.json"));
    write_message(&json!({"type": "fences", "fences": fences}));
}

fn handle_request_observe(vault: &Path) {
    let fences = read_json(&vault.join("fences.json"));
    let mut domains = HashSet::new();
    if let Value::Object(map) = &fences {
        for fence in map.values() {
            if let Some(scope) = fence.get("scope") {
                for d in browser_domains(scope) {
                    domains.insert(d);
                }
            }
        }
    }
    let list: Vec<&str> = domains.iter().map(|s| s.as_str()).collect();
    write_message(&json!({"type": "observe", "domains": list}));
}

fn handle_request_policy(vault: &Path) {
    let fences = read_json(&vault.join("fences.json"));
    let areas = read_collection(vault, "areas");

    // Transforms from browser-scoped fences
    let mut transforms = Vec::new();
    if let Value::Object(map) = &fences {
        for fence in map.values() {
            let scope = match fence.get("scope") {
                Some(s) => s,
                None => continue,
            };
            if scope.get("surface").and_then(|v| v.as_str()) != Some("browser") {
                continue;
            }
            let domains = browser_domains(scope);
            let rule_id = fence.get("id").and_then(|v| v.as_str()).unwrap_or("");
            if let Some(primitives) = fence.get("primitives") {
                transforms.extend(extract_transforms(primitives, rule_id, &domains));
            }
        }
    }

    // Areas list
    let area_list: Vec<Value> = match &areas {
        Value::Object(map) => map.values().map(|a| {
            json!({
                "id": a.get("id"),
                "name": a.get("name"),
                "emoji": a.get("emoji"),
                "color": a.get("color"),
                "tags": a.get("tags").unwrap_or(&json!([])),
            })
        }).collect(),
        _ => vec![],
    };

    // Moment friction from active moment
    let mut moment_friction = Value::Null;
    let active = read_json(&vault.join("activeMoment.json"));
    if let Some(moment_id) = active.get("momentId").and_then(|v| v.as_str()) {
        let moments = read_collection(vault, "moments");
        if let Some(moment) = moments.get(moment_id) {
            let today = today_str();
            if moment.get("day").and_then(|v| v.as_str()) == Some(&today) {
                let allow: Vec<String> = moment
                    .get("refs")
                    .and_then(|v| v.as_array())
                    .map(|refs| {
                        refs.iter()
                            .filter_map(|r| r.as_str())
                            .filter_map(hostname_from_url)
                            .collect()
                    })
                    .unwrap_or_default();
                moment_friction = json!({"allow": allow, "deny": []});
            }
        }
    }

    write_message(&json!({
        "type": "policy",
        "transforms": transforms,
        "break": null,
        "areas": area_list,
        "momentFriction": moment_friction,
    }));
}

fn handle_request_active_moment(vault: &Path) {
    let active = read_json(&vault.join("activeMoment.json"));
    let moment_id = match active.get("momentId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => {
            write_message(&json!({"type": "active_moment", "moment": null}));
            return;
        }
    };

    let moments = read_collection(vault, "moments");
    let areas = read_collection(vault, "areas");
    let today = today_str();

    let moment = match moments.get(moment_id) {
        Some(m) if m.get("day").and_then(|v| v.as_str()) == Some(&today) => m,
        _ => {
            write_message(&json!({"type": "active_moment", "moment": null}));
            return;
        }
    };

    let area_id = moment.get("areaId").and_then(|v| v.as_str()).unwrap_or("");
    let area = areas.get(area_id);

    write_message(&json!({
        "type": "active_moment",
        "moment": {
            "id": moment_id,
            "name": moment.get("name"),
            "area": area.and_then(|a| a.get("name")).unwrap_or(&json!("")),
            "emoji": area.and_then(|a| a.get("emoji")).unwrap_or(&json!("")),
        }
    }));
}

fn handle_request_today_moments(vault: &Path) {
    let today = today_str();
    let moments = read_collection(vault, "moments");
    let areas = read_collection(vault, "areas");
    let configs = read_collection(vault, "phaseConfigs");
    let active = read_json(&vault.join("activeMoment.json"));
    let active_id = active.get("momentId").and_then(|v| v.as_str()).unwrap_or("");

    let mut today_moments: Vec<(i64, Value)> = Vec::new();
    if let Value::Object(map) = &moments {
        for m in map.values() {
            if m.get("day").and_then(|v| v.as_str()) != Some(&today) {
                continue;
            }
            let area_id = m.get("areaId").and_then(|v| v.as_str()).unwrap_or("");
            let area = areas.get(area_id);
            let mid = m.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let order = m.get("order").and_then(|v| v.as_i64()).unwrap_or(0);

            today_moments.push((order, json!({
                "id": mid,
                "name": m.get("name"),
                "phase": m.get("phase").unwrap_or(&json!("")),
                "areaName": area.and_then(|a| a.get("name")).unwrap_or(&json!("")),
                "areaEmoji": area.and_then(|a| a.get("emoji")).unwrap_or(&json!("")),
                "areaColor": area.and_then(|a| a.get("color")).unwrap_or(&json!("")),
                "active": mid == active_id,
                "startTime": m.get("startTime"),
                "durationMin": m.get("durationMin"),
                "status": m.get("status").unwrap_or(&json!("accepted")),
            })));
        }
    }

    today_moments.sort_by_key(|(order, _)| *order);
    let list: Vec<Value> = today_moments.into_iter().map(|(_, v)| v).collect();

    write_message(&json!({
        "type": "today_moments",
        "moments": list,
        "currentPhase": current_phase(&configs),
    }));
}

fn handle_request_events(msg: &Value, vault: &Path) {
    let since = msg.get("since").and_then(|v| v.as_i64()).unwrap_or(0);
    let now = chrono::Utc::now().timestamp_millis();
    let log_dir = vault.join("log");

    if !log_dir.exists() {
        write_message(&json!({"type": "events_slice", "events": [], "done": true}));
        return;
    }

    // Collect matching JSONL files by date range
    let day_ms: i64 = 86_400_000;
    let mut events: Vec<(i64, Value)> = Vec::new();

    let mut ts = since - day_ms;
    while ts <= now + day_ms {
        let date_str = local_date(ts);
        let file = log_dir.join(format!("{date_str}.browser.jsonl"));
        if file.exists() {
            if let Ok(content) = fs::read_to_string(&file) {
                for line in content.lines() {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if let Ok(event) = serde_json::from_str::<Value>(line) {
                        let event_ts = event.get("ts").and_then(|v| v.as_i64()).unwrap_or(0);
                        if event_ts >= since && event_ts < now {
                            events.push((event_ts, event));
                        }
                    }
                }
            }
        }
        ts += day_ms;
    }

    events.sort_by_key(|(ts, _)| *ts);

    if events.is_empty() {
        write_message(&json!({"type": "events_slice", "events": [], "done": true}));
        return;
    }

    let total_chunks = (events.len() + EVENT_CHUNK_SIZE - 1) / EVENT_CHUNK_SIZE;
    for (i, chunk) in events.chunks(EVENT_CHUNK_SIZE).enumerate() {
        let items: Vec<&Value> = chunk.iter().map(|(_, v)| v).collect();
        write_message(&json!({"type": "events_slice", "events": items, "done": i + 1 == total_chunks}));
    }
}

// ── File watcher ────────────────────────────────────────────────────────

fn start_fence_watcher(vault: PathBuf) {
    thread::spawn(move || {
        let (tx, rx) = mpsc::channel();
        let mut watcher = match RecommendedWatcher::new(tx, Config::default()) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[zenborg-native-host] fence watcher failed: {e}");
                return;
            }
        };
        if watcher.watch(&vault, RecursiveMode::NonRecursive).is_err() {
            return;
        }

        let fences_name = std::ffi::OsStr::new("fences.json");
        let debounce = Duration::from_millis(200);
        let mut last_push = Instant::now() - debounce;

        for result in rx {
            let event = match result {
                Ok(e) => e,
                Err(_) => continue,
            };
            let dominated = matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_));
            if !dominated {
                continue;
            }
            let touches_fences = event.paths.iter().any(|p| {
                p.file_name() == Some(fences_name)
            });
            if !touches_fences {
                continue;
            }
            if last_push.elapsed() < debounce {
                continue;
            }
            last_push = Instant::now();

            // Push all three: fences, observe domains, and policy (transforms).
            // The extension handlers are idempotent, so a redundant push is free.
            handle_request_fences(&vault);
            handle_request_observe(&vault);
            handle_request_policy(&vault);
            eprintln!("[zenborg-native-host] fences.json changed, pushed to extension");
        }
    });
}

// ── Main ────────────────────────────────────────────────────────────────

fn main() {
    let vault = vault_root();

    eprintln!(
        "[zenborg-native-host] vault={} pid={}",
        vault.display(),
        std::process::id()
    );

    start_fence_watcher(vault.clone());

    loop {
        let msg = match read_message() {
            Some(m) => m,
            None => break,
        };

        let msg_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match msg_type {
            "events" => handle_events(&msg, &vault),
            "request_fences" => handle_request_fences(&vault),
            "request_observe" => handle_request_observe(&vault),
            "request_policy" => handle_request_policy(&vault),
            "request_active_moment" => handle_request_active_moment(&vault),
            "request_today_moments" => handle_request_today_moments(&vault),
            "request_events" => handle_request_events(&msg, &vault),
            _ => {}
        }
    }
}
