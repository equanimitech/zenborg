//! Power assertions: which app is holding the Mac awake.
//!
//! Read from the per-process list of `pmset -g assertions`, never from the
//! system-wide counters. Brave playing a video in a background tab holds only
//! `NoIdleSleepAssertion "Playing audio"`, and `PreventUserIdleDisplaySleep`
//! stays 0: the counter misses exactly the case that matters.
//!
//! A hold is `(app, assertion type)`. The type comes from the fixed `HOLD_TYPES`
//! allow-list; the assertion's own name is app-supplied free text (it can carry
//! a document or call title) and is never kept. Reasons are never classified: a
//! hold is a hold. The read side bounds the error (lock, 3-h cap).

use std::collections::{BTreeMap, BTreeSet};

/// Assertion types that keep the Mac awake on a user's behalf, as the
/// per-process list names them (the legacy names included).
const HOLD_TYPES: &[&str] = &[
    "NoIdleSleepAssertion",
    "NoDisplaySleepAssertion",
    "PreventUserIdleDisplaySleep",
    "PreventUserIdleSystemSleep",
];

/// System processes that hold system-sleep assertions for their own reasons.
/// Crediting them would credit the whole day.
const IGNORED: &[&str] = &[
    "caffeinate",
    "coreaudiod",
    "powerd",
    "sharingd",
    "useractivityd",
];

/// `(app name, assertion type)`.
pub type Hold = (String, String);

/// The holds in a `pmset -g assertions` dump.
pub fn parse_holds(output: &str) -> BTreeSet<Hold> {
    output
        .lines()
        .filter_map(parse_line)
        .filter(|(app, kind)| HOLD_TYPES.contains(kind) && !IGNORED.contains(app))
        .map(|(app, kind)| (app.to_string(), kind.to_string()))
        .collect()
}

/// `pid 60530(Brave Browser): [0x…] 00:01:19 NoIdleSleepAssertion named: "Playing audio"`
/// → `("Brave Browser", "NoIdleSleepAssertion")`. The `named:` text is dropped.
fn parse_line(line: &str) -> Option<(&str, &str)> {
    let rest = line.trim_start().strip_prefix("pid ")?;
    let (_, rest) = rest.split_once('(')?;
    let (app, rest) = rest.split_once("): [")?;
    let (_, rest) = rest.split_once("] ")?;
    let mut fields = rest.splitn(3, ' ');
    let _age = fields.next()?;
    let kind = fields.next()?;
    (!app.is_empty()).then_some((app, kind))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HoldTransition {
    Start(Hold),
    End { hold: Hold, duration_ms: u64 },
}

/// Diff the current holds against the open ones (`hold → since`), updating
/// them in place. Ends first, then starts, each in a stable order.
pub fn hold_transitions(
    open: &mut BTreeMap<Hold, u64>,
    current: BTreeSet<Hold>,
    now_ms: u64,
) -> Vec<HoldTransition> {
    let gone: Vec<Hold> = open
        .keys()
        .filter(|h| !current.contains(*h))
        .cloned()
        .collect();
    let mut out: Vec<HoldTransition> = gone
        .into_iter()
        .map(|hold| {
            let since = open.remove(&hold).unwrap_or(now_ms);
            HoldTransition::End {
                hold,
                duration_ms: now_ms.saturating_sub(since),
            }
        })
        .collect();
    for hold in current {
        if !open.contains_key(&hold) {
            open.insert(hold.clone(), now_ms);
            out.push(HoldTransition::Start(hold));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Measured 2026-10-09: Brave playing a video, visible, with the usual
    /// system holders alongside. Background playback drops the wake lock line.
    const DUMP: &str = r#"2026-10-09 17:50:07 +0200
Assertion status system-wide:
   BackgroundTask                 0
   UserIsActive                   1
   PreventUserIdleDisplaySleep    1
   PreventSystemSleep             0
   PreventUserIdleSystemSleep     1
Listed by owning process:
   pid 690(sharingd): [0x001a83c00001a59c] 00:01:30 PreventUserIdleSystemSleep named: "Handoff"
   pid 54233(caffeinate): [0x001a83810001a55b] 00:02:33 PreventUserIdleSystemSleep named: "caffeinate command-line tool"
	Details: caffeinate asserting for 300 secs
	Timeout will fire in 147 secs Action=TimeoutActionRelease
   pid 60530(Brave Browser): [0x001a83ca0001a5a1] 00:01:19 NoIdleSleepAssertion named: "Playing audio"
   pid 60530(Brave Browser): [0x001a83ca0005a59f] 00:01:19 NoDisplaySleepAssertion named: "Video Wake Lock"
   pid 323(powerd): [0x001a767900019c95] 00:58:08 PreventUserIdleSystemSleep named: "Powerd - Prevent sleep while display is on"
   pid 380(WindowServer): [0x001a767900099c93] 00:01:14 UserIsActive named: "com.apple.iohideventsystem.queue.tickle"
   pid 493(mds_stores): [0x001a8419000ba5aa] 00:00:01 BackgroundTask named: "com.apple.metadata.mds_stores.power"
   pid 394(coreaudiod): [0x001a83c20001a511] 00:01:27 PreventUserIdleSystemSleep named: "com.apple.audio.output.context.preventuseridlesleep"
	Created for PID: 7256.
   pid 77(useractivityd): [0x001a83c20001a512] 00:00:10 PreventUserIdleSystemSleep named: "BTLE Advertising"
Kernel Assertions: 0x100=MAGICWAKE
   id=581  level=255 0x100=MAGICWAKE creat=13/08/2026, 11:21 description=en0 owner=IOSkywalkNetworkBSDClient
"#;

    fn hold(app: &str, name: &str) -> Hold {
        (app.to_string(), name.to_string())
    }

    #[test]
    fn a_player_holds_the_mac_awake_and_the_system_holders_do_not() {
        assert_eq!(
            parse_holds(DUMP),
            BTreeSet::from([
                hold("Brave Browser", "NoIdleSleepAssertion"),
                hold("Brave Browser", "NoDisplaySleepAssertion"),
            ])
        );
    }

    #[test]
    fn background_playback_holds_only_playing_audio() {
        let line = r#"   pid 60530(Brave Browser): [0x001a83ca0001a5a1] 00:01:19 NoIdleSleepAssertion named: "Playing audio"  "#;
        assert_eq!(
            parse_holds(line),
            BTreeSet::from([hold("Brave Browser", "NoIdleSleepAssertion")])
        );
    }

    #[test]
    fn an_app_supplied_name_never_reaches_a_hold() {
        let line = r#"   pid 1(Player): [0x1] 00:00:01 PreventUserIdleDisplaySleep named: "Call with Alice - Q3 salary"  "#;
        assert_eq!(
            parse_holds(line),
            BTreeSet::from([hold("Player", "PreventUserIdleDisplaySleep")])
        );
    }

    #[test]
    fn transitions_open_and_close_holds_with_their_duration() {
        let mut open = BTreeMap::new();
        let audio = hold("Brave Browser", "NoIdleSleepAssertion");
        let lock = hold("Brave Browser", "NoDisplaySleepAssertion");

        let t = hold_transitions(
            &mut open,
            BTreeSet::from([audio.clone(), lock.clone()]),
            1_000,
        );
        assert_eq!(
            t,
            vec![
                HoldTransition::Start(lock.clone()),
                HoldTransition::Start(audio.clone())
            ]
        );

        // The tab goes to the background: the wake lock goes, the audio stays.
        let t = hold_transitions(&mut open, BTreeSet::from([audio.clone()]), 16_000);
        assert_eq!(
            t,
            vec![HoldTransition::End {
                hold: lock,
                duration_ms: 15_000
            }]
        );
        assert!(hold_transitions(&mut open, BTreeSet::from([audio.clone()]), 31_000).is_empty());

        let t = hold_transitions(&mut open, BTreeSet::new(), 46_000);
        assert_eq!(
            t,
            vec![HoldTransition::End {
                hold: audio,
                duration_ms: 45_000
            }]
        );
        assert!(open.is_empty());
    }
}
