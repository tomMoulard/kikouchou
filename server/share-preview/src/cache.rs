//! A small time-boxed cache, so one pasted link is one read.
//!
//! A link dropped into a busy chat is fetched several times within seconds: the
//! unfurler asks for the page, then for the card, and every other client in the
//! room may ask again. Without this, each of those rebuilds a Yjs document from
//! a snapshot and a log, and rasterises a card.
//!
//! Entries expire rather than being invalidated, and the window is short for one
//! reason: revocation. An invite withdrawn at 12:00 must stop rendering, and the
//! longest it can keep rendering is this TTL. Minutes, never hours.
//!
//! Two requests that miss the same cold key both do the work. Deduplicating
//! them would mean holding a shared future under the lock, and the thing being
//! deduplicated is one database read on a service that answers a handful of
//! requests a minute.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

// ============================================================================
// Types
// ============================================================================

/// Values keyed by string, each forgotten once its time is up.
pub struct TtlCache<T> {
    entries: Mutex<HashMap<String, (Instant, Arc<T>)>>,
    ttl: Duration,
    max_entries: usize,
}

// ============================================================================
// Public API
// ============================================================================

impl<T> TtlCache<T> {
    pub fn new(ttl_seconds: u64, max_entries: usize) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            ttl: Duration::from_secs(ttl_seconds),
            max_entries,
        }
    }

    /// The value for `key`, if it is present and still fresh.
    pub fn get(&self, key: &str, now: Instant) -> Option<Arc<T>> {
        let entries = self.lock();
        entries
            .get(key)
            .filter(|(expires_at, _)| *expires_at > now)
            .map(|(_, value)| Arc::clone(value))
    }

    /// Stores a value and hands back the shared handle to it.
    pub fn insert(&self, key: &str, value: T, now: Instant) -> Arc<T> {
        let shared = Arc::new(value);
        let mut entries = self.lock();
        entries.insert(key.to_owned(), (now + self.ttl, Arc::clone(&shared)));

        // Drop what has expired, and — only if that was not enough — enough
        // arbitrary entries to stay under the ceiling. A cache that grows
        // without a bound is a slow leak on a long-lived process.
        entries.retain(|_, (expires_at, _)| *expires_at > now);
        while entries.len() > self.max_entries {
            let Some(victim) = entries.keys().next().cloned() else {
                break;
            };
            entries.remove(&victim);
        }

        shared
    }

    /// Entries held. Exposed for the tests.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.lock().len()
    }

    /// Takes the lock, recovering from a panic in another thread.
    ///
    /// A poisoned cache is still a correct cache: every entry in it is a value
    /// that was read from the database, and none of them is torn. Refusing to
    /// serve previews because an unrelated request panicked would be the worse
    /// failure.
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, (Instant, Arc<T>)>> {
        self.entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hands_back_what_was_stored() {
        let cache: TtlCache<String> = TtlCache::new(60, 10);
        let now = Instant::now();

        cache.insert("k", "value".to_owned(), now);

        assert_eq!(cache.get("k", now).as_deref(), Some(&"value".to_owned()));
    }

    #[test]
    fn forgets_an_entry_once_it_has_expired() {
        let cache: TtlCache<String> = TtlCache::new(60, 10);
        let now = Instant::now();

        cache.insert("k", "value".to_owned(), now);

        assert!(cache.get("k", now + Duration::from_secs(59)).is_some());
        assert!(cache.get("k", now + Duration::from_secs(61)).is_none());
    }

    #[test]
    fn knows_nothing_about_a_key_it_was_never_given() {
        let cache: TtlCache<String> = TtlCache::new(60, 10);

        assert!(cache.get("absent", Instant::now()).is_none());
    }

    #[test]
    fn stays_bounded() {
        let cache: TtlCache<String> = TtlCache::new(60, 3);
        let now = Instant::now();

        for index in 0..10 {
            cache.insert(&format!("k{index}"), "value".to_owned(), now);
        }

        assert_eq!(cache.len(), 3);
    }

    #[test]
    fn sweeps_expired_entries_when_a_new_one_arrives() {
        let cache: TtlCache<String> = TtlCache::new(60, 100);
        let now = Instant::now();

        cache.insert("old", "value".to_owned(), now);
        cache.insert("new", "value".to_owned(), now + Duration::from_secs(61));

        assert_eq!(cache.len(), 1);
    }
}
