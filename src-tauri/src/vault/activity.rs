//! Read access to the activity log for the app's `/week`.
//!
//! Returns raw file text, one entry per `log/<day>.<surface>.jsonl` in the
//! range. No parsing here: the TS domain (`parseActivityLines`) owns the line
//! shape, so it is paid for once, not twice.

use std::fs;
use std::path::Path;

use chrono::NaiveDate;
use serde::Serialize;

/// Wider than any readback (two weeks plus a roll day either side), small
/// enough that a typo'd year cannot read the whole log into the webview.
const MAX_DAYS: i64 = 400;

#[derive(Debug, Serialize, PartialEq)]
pub struct ActivityFile {
    pub day: String,
    pub surface: String,
    pub text: String,
}

fn parse_day(s: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| format!("Not a YYYY-MM-DD day: {s}"))
}

/// Every `<day>.<surface>.jsonl` in `log_dir` with `from <= day <= to`
/// (local calendar days, the files' own buckets). A missing directory is empty.
pub fn read_activity_files(
    log_dir: &Path,
    from: &str,
    to: &str,
) -> Result<Vec<ActivityFile>, String> {
    let (from, to) = (parse_day(from)?, parse_day(to)?);
    if to < from {
        return Err(format!("to ({to}) is before from ({from})"));
    }
    if (to - from).num_days() > MAX_DAYS {
        return Err(format!("Range over {MAX_DAYS} days"));
    }
    let Ok(entries) = fs::read_dir(log_dir) else {
        return Ok(vec![]);
    };
    let mut files = vec![];
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(stem) = name.strip_suffix(".jsonl") else {
            continue;
        };
        let Some((day, surface)) = stem.split_once('.') else {
            continue;
        };
        let Ok(date) = parse_day(day) else { continue };
        if date < from || date > to || surface.is_empty() || surface.contains('.') {
            continue;
        }
        // A file mid-write or unreadable is one lost bucket, not a failed read.
        let Ok(text) = fs::read_to_string(entry.path()) else {
            continue;
        };
        files.push(ActivityFile {
            day: day.to_string(),
            surface: surface.to_string(),
            text,
        });
    }
    files.sort_by(|a, b| (&a.day, &a.surface).cmp(&(&b.day, &b.surface)));
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_files_in_range_and_skips_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        fs::write(p.join("2026-10-05.desktop.jsonl"), "{\"a\":1}\n").unwrap();
        fs::write(p.join("2026-10-06.browser.jsonl"), "x").unwrap();
        fs::write(p.join("2026-10-12.desktop.jsonl"), "late").unwrap();
        fs::write(p.join("2026-10-05.desktop.jsonl.bak"), "no").unwrap();
        fs::write(p.join("notes.txt"), "no").unwrap();

        let files = read_activity_files(p, "2026-10-05", "2026-10-11").unwrap();
        assert_eq!(
            files,
            vec![
                ActivityFile {
                    day: "2026-10-05".into(),
                    surface: "desktop".into(),
                    text: "{\"a\":1}\n".into()
                },
                ActivityFile {
                    day: "2026-10-06".into(),
                    surface: "browser".into(),
                    text: "x".into()
                },
            ]
        );
    }

    #[test]
    fn missing_dir_is_empty_and_bad_input_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            read_activity_files(&dir.path().join("log"), "2026-10-05", "2026-10-11").unwrap(),
            vec![]
        );
        assert!(read_activity_files(dir.path(), "../etc", "2026-10-11").is_err());
        assert!(read_activity_files(dir.path(), "2026-10-11", "2026-10-05").is_err());
        assert!(read_activity_files(dir.path(), "2020-01-01", "2026-10-05").is_err());
    }
}
