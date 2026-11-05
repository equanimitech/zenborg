//! Self-write suppression, ported from penceive.
//!
//! When we write a file, the OS notify watcher fires for our own write.
//! Without suppression we'd bounce: write → event → reload → write.
//!
//! We remember a hash of the bytes we last wrote to each collection. An
//! event is our own echo only while the file still holds exactly those
//! bytes. This used to be a 3 s window per path, which also swallowed any
//! other writer (the MCP server) landing within 3 s of an app write: the
//! UI stayed stale and the next app write clobbered the external change
//! (#208). Comparing content suppresses every duplicate FSEvent of our own
//! write (#76) without hiding anyone else's.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;

fn digest(bytes: &[u8]) -> u64 {
    let mut h = DefaultHasher::new();
    bytes.hash(&mut h);
    h.finish()
}

pub struct SelfWriteTracker {
    writes: Mutex<HashMap<String, u64>>,
}

impl SelfWriteTracker {
    pub fn new() -> Self {
        Self {
            writes: Mutex::new(HashMap::new()),
        }
    }

    /// Called before writing a collection. Remembers the bytes being written.
    pub fn register_write(&self, collection: &str, bytes: &[u8]) {
        let mut writes = self.writes.lock().unwrap();
        writes.insert(collection.to_string(), digest(bytes));
    }

    /// Called by the watcher with the file's current bytes. True when they
    /// are exactly what we last wrote, so the event is our own echo.
    ///
    /// On a mismatch someone else owns the file now, so the record is
    /// dropped: a later external write that happens to restore our old
    /// bytes is still reported.
    pub fn is_self_write(&self, collection: &str, current: &[u8]) -> bool {
        let mut writes = self.writes.lock().unwrap();
        match writes.get(collection) {
            Some(&ours) if ours == digest(current) => true,
            Some(_) => {
                writes.remove(collection);
                false
            }
            None => false,
        }
    }
}

impl Default for SelfWriteTracker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suppresses_duplicate_events_of_our_own_write() {
        let tracker = SelfWriteTracker::new();
        tracker.register_write("habits", b"{\"a\":1}");

        assert!(tracker.is_self_write("habits", b"{\"a\":1}"));
        // macOS delivers more than one event per rename: all are ours.
        assert!(tracker.is_self_write("habits", b"{\"a\":1}"));
    }

    #[test]
    fn reports_an_external_write_right_after_ours() {
        // #208: the MCP server writes moments.json a moment after the app did.
        let tracker = SelfWriteTracker::new();
        tracker.register_write("moments", b"{\"m1\":\"accepted\"}");

        assert!(!tracker.is_self_write("moments", b"{\"m1\":\"tentative\"}"));
    }

    #[test]
    fn reports_an_external_revert_to_our_old_bytes() {
        let tracker = SelfWriteTracker::new();
        tracker.register_write("moments", b"A");

        assert!(!tracker.is_self_write("moments", b"B"));
        assert!(!tracker.is_self_write("moments", b"A"));
    }

    #[test]
    fn a_newer_write_of_ours_replaces_the_older_one() {
        let tracker = SelfWriteTracker::new();
        tracker.register_write("habits", b"A1");
        tracker.register_write("habits", b"A2");

        // A late event for A1's rename reads the file as A2: still ours.
        assert!(tracker.is_self_write("habits", b"A2"));
    }

    #[test]
    fn unrelated_collections_are_independent() {
        let tracker = SelfWriteTracker::new();
        tracker.register_write("habits", b"A");

        assert!(!tracker.is_self_write("moments", b"A"));
        assert!(tracker.is_self_write("habits", b"A"));
    }
}
