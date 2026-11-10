//! Chrome native messaging host for the zenborg browser extension.
//!
//! Chrome spawns this on demand when the extension opens a native messaging
//! connection. Reads from stdin, writes to stdout, both framed with Chrome's
//! native messaging protocol (uint32 LE length prefix + UTF-8 JSON, 1MB max).
//!
//! Not a daemon — Chrome manages the lifecycle.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use chrono::{Local, Timelike, TimeZone};
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

/// The moment the pointer names at `now_ms`. Mirrors `resolvePointer` in
/// `src/domain/attention/ActiveMoment.ts`: a timed switch past its `until`
/// reads as its `returnTo`, or none. An unparseable `until` reads as untimed.
fn resolve_active(pointer: &Value, now_ms: i64) -> Option<String> {
    let id = pointer.get("momentId").and_then(|v| v.as_str()).filter(|s| !s.is_empty())?;
    let expired = pointer
        .get("until")
        .and_then(|v| v.as_str())
        .and_then(|u| chrono::DateTime::parse_from_rfc3339(u).ok())
        .is_some_and(|u| u.timestamp_millis() <= now_ms);
    if !expired {
        return Some(id.to_string());
    }
    pointer
        .get("returnTo")
        .and_then(|r| r.get("momentId"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
}

fn active_moment_id(vault: &Path) -> Option<String> {
    resolve_active(
        &read_json(&vault.join("activeMoment.json")),
        chrono::Utc::now().timestamp_millis(),
    )
}

/// Ask the writer. The extension is a reader of the vault, so a state change
/// runs `zenborg-mcp` — the sibling binary in the app bundle — as a one-shot
/// CLI rather than writing here. Its stdout is captured, never forwarded:
/// this process's stdout is the native messaging channel.
fn run_mcp(vault: &Path, args: &[&str]) -> Result<Value, String> {
    // ponytail: sibling-of-exe only; a dev build has no bundled zenborg-mcp and fails soft
    let bin = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .with_file_name("zenborg-mcp");
    let out = Command::new(&bin)
        .args(args)
        .arg("--vault")
        .arg(vault)
        .output()
        .map_err(|e| format!("{}: {e}", bin.display()))?;
    let reply: Value = serde_json::from_slice(&out.stdout).unwrap_or(Value::Null);
    if out.status.success() {
        Ok(reply)
    } else {
        Err(reply
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("zenborg-mcp refused")
            .to_string())
    }
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

/// The observe tier the extension arms its video sense on: browser fence
/// domains plus every host the vault maps to an area (`map_area` kind=host writes
/// `areas[].surfaces.hosts`). Mapping a site to an area is what gets its players
/// sensed; there is no second list to keep. The extension's other senses do not
/// read this. Sorted, so the reply is stable.
fn observe_domains(fences: &Value, areas: &Value) -> Vec<String> {
    let mut domains = HashSet::new();
    if let Value::Object(map) = fences {
        for fence in map.values() {
            if let Some(scope) = fence.get("scope") {
                for d in browser_domains(scope) {
                    domains.insert(d);
                }
            }
        }
    }
    if let Value::Object(map) = areas {
        for area in map.values() {
            let hosts = area.pointer("/surfaces/hosts").and_then(|v| v.as_array());
            for h in hosts.into_iter().flatten().filter_map(|v| v.as_str()) {
                domains.insert(h.to_string());
            }
        }
    }
    let mut list: Vec<String> = domains.into_iter().collect();
    list.sort();
    list
}

fn handle_request_observe(vault: &Path) {
    let fences = read_json(&vault.join("fences.json"));
    let areas = read_collection(vault, "areas");
    write_message(&json!({"type": "observe", "domains": observe_domains(&fences, &areas)}));
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
            // Paused by set_fence_enabled: a paused transform must stop hiding.
            if fence.get("defaultEnabled") == Some(&Value::Bool(false)) {
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
    if let Some(moment_id) = active_moment_id(vault) {
        let moments = read_collection(vault, "moments");
        if let Some(moment) = moments.get(&moment_id) {
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
        "areas": area_list,
        "momentFriction": moment_friction,
    }));
}

fn handle_request_active_moment(vault: &Path) {
    let moment_id = match active_moment_id(vault) {
        Some(id) => id,
        None => {
            write_message(&json!({"type": "active_moment", "moment": null}));
            return;
        }
    };

    let moments = read_collection(vault, "moments");
    let areas = read_collection(vault, "areas");
    let today = today_str();

    let moment = match moments.get(&moment_id) {
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
    let habits = read_collection(vault, "habits");
    let active_id = active_moment_id(vault).unwrap_or_default();

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
            // What the intention gate matches a host against: the moment's refs as
            // hostnames, and the name of the habit it waters.
            let hosts: Vec<String> = m
                .get("refs")
                .and_then(|v| v.as_array())
                .map(|refs| refs.iter().filter_map(|r| r.as_str()).filter_map(hostname_from_url).collect())
                .unwrap_or_default();
            let habit_name = m
                .get("habitId")
                .and_then(|v| v.as_str())
                .and_then(|h| habits.get(h))
                .and_then(|h| h.get("name"))
                .cloned()
                .unwrap_or(Value::Null);

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
                "hosts": hosts,
                "habitName": habit_name,
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

/// Local dates covering since..now (one day of slack each side), each once.
/// Stepping 24h can land on the same local date twice on a 25h DST-end day.
/// A 23h day never skips a date: 24h from 00:00 lands at 01:00 next day.
fn log_dates(since: i64, now: i64, date_of: impl Fn(i64) -> String) -> Vec<String> {
    let day_ms: i64 = 86_400_000;
    let mut dates: Vec<String> = Vec::new();
    let mut ts = since - day_ms;
    while ts <= now + day_ms {
        let d = date_of(ts);
        if !dates.contains(&d) {
            dates.push(d);
        }
        ts += day_ms;
    }
    dates
}

fn handle_request_events(msg: &Value, vault: &Path) {
    let since = msg.get("since").and_then(|v| v.as_i64()).unwrap_or(0);
    // Optional: only these kinds (the pass count asks for `pass_used` over a
    // month and has no use for a month of browsing). Absent means every kind.
    let kinds: Option<HashSet<&str>> = msg
        .get("kinds")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|k| k.as_str()).collect());
    let now = chrono::Utc::now().timestamp_millis();
    let log_dir = vault.join("log");

    if !log_dir.exists() {
        write_message(&json!({"type": "events_slice", "events": [], "done": true}));
        return;
    }

    // Collect matching JSONL files by date range
    let mut events: Vec<(i64, Value)> = Vec::new();

    for date_str in log_dates(since, now, local_date) {
        let file = log_dir.join(format!("{date_str}.browser.jsonl"));
        if file.exists() {
            if let Ok(content) = fs::read_to_string(&file) {
                for line in content.lines() {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if let Ok(event) = serde_json::from_str::<Value>(line) {
                        let event_ts = event.get("ts").and_then(|v| v.as_i64()).unwrap_or(0);
                        let kind_ok = kinds.as_ref().map_or(true, |ks| {
                            event.get("kind").and_then(|k| k.as_str()).is_some_and(|k| ks.contains(k))
                        });
                        if event_ts >= since && event_ts < now && kind_ok {
                            events.push((event_ts, event));
                        }
                    }
                }
            }
        }
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

/// The intention gate's start: a timed switch, through the writer.
fn handle_switch_moment(msg: &Value, vault: &Path) {
    let id = msg.get("momentId").and_then(|v| v.as_str()).filter(|s| !s.is_empty() && s.len() <= 128);
    let minutes = msg.get("minutes").and_then(|v| v.as_u64()).filter(|m| (1..=240).contains(m));
    let result = match (id, minutes) {
        (Some(id), Some(min)) => run_mcp(vault, &["switch-moment", id, &min.to_string()]),
        _ => Err("bad switch_moment".to_string()),
    };
    write_message(&match result {
        Ok(reply) => json!({"type": "moment_switched", "ok": true, "pointer": reply.get("value")}),
        Err(e) => json!({"type": "moment_switched", "ok": false, "error": e}),
    });
}

/// The reflection at the end of a gate's switch, through the writer.
fn handle_reflect(msg: &Value, vault: &Path) {
    let field = |k: &str| msg.get(k).and_then(|v| v.as_str()).filter(|s| s.len() <= 500);
    let result = match (field("momentId"), field("text")) {
        (Some(id), Some(text)) if !id.is_empty() && !text.trim().is_empty() => run_mcp(
            vault,
            &["reflect", id, text, "--intention", field("intention").unwrap_or("")],
        ),
        _ => Err("bad reflect".to_string()),
    };
    write_message(&match result {
        Ok(_) => json!({"type": "reflected", "ok": true}),
        Err(e) => json!({"type": "reflected", "ok": false, "error": e}),
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
            "switch_moment" => handle_switch_moment(&msg, &vault),
            "reflect" => handle_reflect(&msg, &vault),
            // Never drop silently: a stale extension speaking a retired
            // message name (request_armed, before f0eb615) must hear why it
            // gets nothing back.
            other => write_message(&json!({"type": "error", "error": "unknown_type", "received": other})),
        }
    }
}

#[cfg(test)]
mod pointer_tests {
    use super::*;

    const T0: i64 = 1_793_476_800_000; // 2026-10-31T20:00:00Z

    #[test]
    fn old_pointer_without_new_fields() {
        let p = json!({"momentId": "a", "at": "2026-10-31T20:00:00.000Z"});
        assert_eq!(resolve_active(&p, T0 + 999_999_999), Some("a".into()));
    }

    #[test]
    fn timed_switch_returns_on_expiry() {
        let p = json!({
            "momentId": "yt", "at": "2026-10-31T20:00:00.000Z",
            "until": "2026-10-31T20:30:00.000Z",
            "returnTo": {"momentId": "work", "at": "2026-10-31T18:00:00.000Z"},
            "future": "unknown fields are ignored"
        });
        assert_eq!(resolve_active(&p, T0 + 29 * 60_000), Some("yt".into()));
        assert_eq!(resolve_active(&p, T0 + 30 * 60_000), Some("work".into()));
    }

    #[test]
    fn timed_switch_without_return_clears() {
        let p = json!({"momentId": "yt", "at": "x", "until": "2026-10-31T20:15:00.000Z"});
        assert_eq!(resolve_active(&p, T0 + 15 * 60_000), None);
    }

    #[test]
    fn empty_or_malformed() {
        assert_eq!(resolve_active(&json!({}), T0), None);
        let p = json!({"momentId": "a", "at": "x", "until": "soon"});
        assert_eq!(resolve_active(&p, T0), Some("a".into()));
    }
}

#[cfg(test)]
mod dst_tests {
    use super::*;
    use chrono::{FixedOffset, Utc};

    /// Europe/London 2026: BST (+1) from 03-29 01:00Z to 10-25 01:00Z, else GMT.
    fn london_date(ts: i64) -> String {
        let h = if (1_774_746_000_000..1_792_890_000_000).contains(&ts) { 3600 } else { 0 };
        let tz = FixedOffset::east_opt(h).unwrap();
        Utc.timestamp_millis_opt(ts).unwrap().with_timezone(&tz).format("%Y-%m-%d").to_string()
    }

    fn utc_ms(y: i32, m: u32, d: u32) -> i64 {
        Utc.with_ymd_and_hms(y, m, d, 0, 0, 0).unwrap().timestamp_millis()
    }

    #[test]
    fn log_dates_once_across_dst() {
        // `since` = a day after local midnight (BST 00:00 = 23:00Z the day before), so
        // the walk starts on local midnight: 24h later is 23:00 the same day on a 25h day.
        let h = 3_600_000;
        for (since, until) in [
            (utc_ms(2026, 10, 24) - h + 86_400_000, utc_ms(2026, 10, 30)),
            (utc_ms(2026, 3, 28) + 86_400_000, utc_ms(2026, 4, 3)),
        ] {
            let dates = log_dates(since, until, london_date);
            let mut uniq = dates.clone();
            uniq.dedup();
            assert_eq!(dates, uniq, "duplicate date: {dates:?}");
            // consecutive calendar days, no gaps
            for w in dates.windows(2) {
                let p = |s: &str| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap();
                assert_eq!((p(&w[1]) - p(&w[0])).num_days(), 1, "gap in {dates:?}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_host_mapped_to_an_area_is_observed_and_an_unmapped_one_is_not() {
        let areas = json!({
            "a1": { "id": "a1", "name": "Entertainment", "surfaces": { "hosts": ["example.tv"], "apps": ["Player"] } },
            "a2": { "id": "a2", "name": "Work", "surfaces": { "paths": ["~/dev"] } },
            "a3": { "id": "a3", "name": "Bare" }
        });
        let observed = observe_domains(&json!({}), &areas);
        assert_eq!(observed, vec!["example.tv".to_string()]);
        assert!(!observed.contains(&"player.example.net".to_string()));
    }

    #[test]
    fn fence_domains_and_area_hosts_merge_once() {
        let fences = json!({
            "f1": { "id": "f1", "scope": { "surface": "browser", "domain": ["example.tv", "fenced.example.org"] } },
            "f2": { "id": "f2", "scope": { "surface": "desktop", "domain": "ignored.example" } }
        });
        let areas = json!({ "a1": { "surfaces": { "hosts": ["example.tv"] } } });
        assert_eq!(
            observe_domains(&fences, &areas),
            vec!["example.tv".to_string(), "fenced.example.org".to_string()]
        );
    }

    #[test]
    fn a_missing_or_malformed_areas_file_observes_nothing_extra() {
        assert!(observe_domains(&json!({}), &json!({})).is_empty());
        assert!(observe_domains(&json!({}), &json!({ "a1": { "surfaces": { "hosts": "example.tv" } } })).is_empty());
    }
}
