//! Pure config parsing for the observer and scheduler.
//!
//! Every parser here reads one JSON document and returns a typed struct.
//! No I/O, no environment — those are the caller's concern.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

/// Default log directory name under the vault root.
pub const LOG_DIR: &str = "log";

/// Legacy aliases — kept so existing tests and callers compile.
pub const PARITY_LOG_DIR: &str = LOG_DIR;
pub const LIVE_LOG_DIR: &str = LOG_DIR;

/// What the observer was told to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObserverConfig {
    pub enabled: bool,
    /// Directory *name* under keel's subtree, never an absolute path.
    pub log_dir_name: String,
    /// Launch without showing the window.
    pub start_hidden: bool,
}

impl Default for ObserverConfig {
    fn default() -> Self {
        ObserverConfig {
            enabled: true,
            log_dir_name: LOG_DIR.to_string(),
            start_hidden: false,
        }
    }
}

/// Parse `desktop.backgroundObserver` out of keel's config document.
///
/// Pure, so the defaults are testable without a vault. Anything malformed
/// reads as the default, which is off — a config this writer cannot understand
/// must never be read as consent to write.
pub fn parse_observer_config(config_json: &str) -> ObserverConfig {
    let node = serde_json::from_str::<Value>(config_json)
        .ok()
        .and_then(|c| c.get("desktop")?.get("backgroundObserver").cloned());

    let Some(node) = node else {
        return ObserverConfig::default();
    };

    let enabled = node
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    let log_dir_name = node
        .get("logDirName")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty() && !name.contains('/') && *name != ".." && *name != ".")
        .unwrap_or(LOG_DIR)
        .to_string();

    let start_hidden = node
        .get("startHidden")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        && enabled;

    ObserverConfig {
        enabled,
        log_dir_name,
        start_hidden,
    }
}

/// Config, then environment. The env overrides exist for the parity run and
/// for tests; they are not the supported way to turn this on for real.
pub fn resolve_observer_config(config_json: &str) -> ObserverConfig {
    let mut config = parse_observer_config(config_json);

    match std::env::var("ZENBORG_OBSERVER").as_deref() {
        Ok("1") | Ok("true") => config.enabled = true,
        Ok("0") | Ok("false") => config.enabled = false,
        _ => {}
    }
    if let Ok(name) = std::env::var("ZENBORG_OBSERVER_LOG_DIR") {
        if !name.is_empty() && !name.contains('/') {
            config.log_dir_name = name;
        }
    }
    config
}

// ── Scheduler config ──────────────────────────────────────────────

/// When a job fires.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Trigger {
    /// `StartInterval`, with `RunAtLoad` folded in as `run_at_load`.
    Interval { seconds: u64, run_at_load: bool },
    /// `WatchPaths`. `debounce` is the quiet period a burst has to settle for.
    Watch {
        paths: Vec<PathBuf>,
        debounce: Duration,
    },
}

/// One scheduled job.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Job {
    pub name: String,
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub trigger: Trigger,
}

const MIN_INTERVAL: Duration = Duration::from_secs(60);
const DEFAULT_DEBOUNCE: Duration = Duration::from_secs(30);

/// The zenborg jobs collection, at the vault root.
pub const JOBS_FILE: &str = "jobs.json";

/// Parse `<vault>/jobs.json` — a JSON object keyed by job id, like every
/// other vault collection. A job's `name` defaults to its id.
///
/// Pure, and forgiving in exactly one direction: a job that cannot be read is
/// dropped, never guessed at.
pub fn parse_jobs(jobs_json: &str) -> Vec<Job> {
    let Some(Value::Object(map)) = serde_json::from_str::<Value>(jobs_json).ok() else {
        return Vec::new();
    };
    map.iter()
        .filter_map(|(id, node)| parse_job(id, node))
        .collect()
}

fn parse_job(id: &str, node: &Value) -> Option<Job> {
    if node.get("enabled").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let name = node
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(id)
        .to_string();
    let program = PathBuf::from(node.get("program").and_then(Value::as_str)?);
    if name.is_empty() || program.as_os_str().is_empty() {
        return None;
    }

    let args = node
        .get("args")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    let env = node
        .get("env")
        .and_then(Value::as_object)
        .map(|o| {
            o.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        })
        .unwrap_or_default();

    let trigger = parse_trigger(node.get("trigger")?)?;

    Some(Job {
        name,
        program,
        args,
        env,
        trigger,
    })
}

fn parse_trigger(node: &Value) -> Option<Trigger> {
    match node.get("kind").and_then(Value::as_str)? {
        "interval" => {
            let seconds = node.get("seconds").and_then(Value::as_u64)?;
            Some(Trigger::Interval {
                seconds: seconds.max(MIN_INTERVAL.as_secs()),
                run_at_load: node
                    .get("runAtLoad")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        }
        "watch" => {
            let paths: Vec<PathBuf> = node
                .get("paths")?
                .as_array()?
                .iter()
                .filter_map(Value::as_str)
                .map(PathBuf::from)
                .collect();
            if paths.is_empty() {
                return None;
            }
            let debounce = node
                .get("debounceSeconds")
                .and_then(Value::as_u64)
                .map(Duration::from_secs)
                .unwrap_or(DEFAULT_DEBOUNCE);
            Some(Trigger::Watch { paths, debounce })
        }
        _ => None,
    }
}

/// The set of directories a watch trigger has to subscribe to.
pub fn watch_roots(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    for path in paths {
        if let Some(parent) = path.parent() {
            let parent = parent.to_path_buf();
            if !roots.contains(&parent) {
                roots.push(parent);
            }
        }
    }
    roots
}

/// What the UI (or the MCP surface, later) can see about the observer.
#[derive(Debug, Clone, Serialize)]
pub struct ObserverStatus {
    pub enabled: bool,
    pub running: bool,
    pub paused: bool,
    #[serde(rename = "permissionNeeded")]
    pub permission_needed: bool,
    #[serde(rename = "logDir")]
    pub log_dir: String,
    pub parity: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_absent_or_broken_config_enables_the_observer_with_defaults() {
        for input in ["", "{ not json", "{}", r#"{"desktop":{}}"#] {
            let config = parse_observer_config(input);
            assert!(config.enabled, "input {input:?} must enable the writer by default");
            assert_eq!(config.log_dir_name, LOG_DIR);
        }
    }

    #[test]
    fn explicit_disable_turns_the_observer_off() {
        let config = parse_observer_config(
            r#"{"desktop":{"backgroundObserver":{"enabled":false}}}"#,
        );
        assert!(!config.enabled);
    }

    #[test]
    fn enabling_alone_writes_to_the_default_log_directory() {
        let config =
            parse_observer_config(r#"{"desktop":{"backgroundObserver":{"enabled":true}}}"#);
        assert!(config.enabled);
        assert_eq!(config.log_dir_name, LOG_DIR);
    }

    #[test]
    fn a_custom_dir_name_is_honoured() {
        let config = parse_observer_config(
            r#"{"desktop":{"backgroundObserver":{"enabled":true,"logDirName":"custom"}}}"#,
        );
        assert_eq!(config.log_dir_name, "custom");
    }

    #[test]
    fn a_path_shaped_dir_name_is_refused_rather_than_sanitized() {
        for name in ["../../etc", "log/nested", "", "."] {
            let json = format!(
                r#"{{"desktop":{{"backgroundObserver":{{"enabled":true,"logDirName":"{name}"}}}}}}"#
            );
            assert_eq!(parse_observer_config(&json).log_dir_name, LOG_DIR);
        }
    }

    #[test]
    fn the_window_never_hides_while_the_observer_is_off() {
        let config = parse_observer_config(
            r#"{"desktop":{"backgroundObserver":{"enabled":false,"startHidden":true}}}"#,
        );
        assert!(!config.start_hidden);

        let config = parse_observer_config(
            r#"{"desktop":{"backgroundObserver":{"enabled":true,"startHidden":true}}}"#,
        );
        assert!(config.start_hidden);
    }

    // ── Scheduler tests ──

    #[test]
    fn an_absent_or_broken_jobs_file_schedules_nothing() {
        for input in ["", "{ not json", "{}", "[]", r#"{"desktop":{"scheduler":{"jobs":[]}}}"#] {
            assert!(parse_jobs(input).is_empty(), "input {input:?}");
        }
    }

    #[test]
    fn a_job_has_to_say_enabled_out_loud() {
        let json = r#"{"garmin":
            {"program":"/x","trigger":{"kind":"interval","seconds":3600}}
        }"#;
        assert!(parse_jobs(json).is_empty());
    }

    #[test]
    fn an_interval_job_is_keyed_by_id_and_named_after_it() {
        let json = r#"{"garmin":{
            "enabled":true,
            "program":"/repo/integrations/garmin/garmin_sync.py",
            "env":{"PATH":"/opt/homebrew/bin:/usr/bin:/bin"},
            "trigger":{"kind":"interval","seconds":3600,"runAtLoad":true}
        }}"#;
        let jobs = parse_jobs(json);
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].name, "garmin");
        assert_eq!(
            jobs[0].trigger,
            Trigger::Interval {
                seconds: 3600,
                run_at_load: true
            }
        );
        assert_eq!(
            jobs[0].env.get("PATH").map(String::as_str),
            Some("/opt/homebrew/bin:/usr/bin:/bin")
        );
    }

    #[test]
    fn a_watch_job_carries_its_args_paths_and_debounce() {
        let json = r#"{"voicememos":{
            "id":"voicememos","name":"Voice memos","enabled":true,
            "program":"/Users/x/.local/bin/murmur",
            "args":["sync"],
            "trigger":{"kind":"watch","paths":["/db/Cloud.db","/db/Cloud.db-wal"],"debounceSeconds":300}
        }}"#;
        let jobs = parse_jobs(json);
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].name, "Voice memos");
        assert_eq!(jobs[0].args, vec!["sync"]);
        assert_eq!(
            jobs[0].trigger,
            Trigger::Watch {
                paths: vec![PathBuf::from("/db/Cloud.db"), PathBuf::from("/db/Cloud.db-wal")],
                debounce: Duration::from_secs(300),
            }
        );
    }

    #[test]
    fn a_watch_subscribes_to_the_directory_and_deduplicates_it() {
        let roots = watch_roots(&[
            PathBuf::from("/db/main.sqlite"),
            PathBuf::from("/db/main.sqlite-wal"),
            PathBuf::from("/other/x"),
        ]);
        assert_eq!(roots, vec![PathBuf::from("/db"), PathBuf::from("/other")]);
    }

    #[test]
    fn a_reckless_interval_is_floored_rather_than_honoured() {
        let json = r#"{"busy":{
            "enabled":true,"program":"/x",
            "trigger":{"kind":"interval","seconds":1}
        }}"#;
        assert_eq!(
            parse_jobs(json)[0].trigger,
            Trigger::Interval {
                seconds: 60,
                run_at_load: false
            }
        );
    }

    #[test]
    fn an_unreadable_job_is_dropped_and_its_siblings_still_run() {
        let json = r#"{
            "programless":{"enabled":true,"trigger":{"kind":"interval","seconds":3600}},
            "unknown":{"enabled":true,"program":"/x","trigger":{"kind":"cron","expr":"* * * * *"}},
            "pathless-watch":{"enabled":true,"program":"/x","trigger":{"kind":"watch","paths":[]}},
            "not-an-object":"oops",
            "good":{"enabled":true,"program":"/x","trigger":{"kind":"interval","seconds":3600}}
        }"#;
        let jobs = parse_jobs(json);
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].name, "good");
    }
}
