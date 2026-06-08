//! The adaptive output-capacity hint.
//!
//! Each compiled template owns a function-local `static SizeHint`. It remembers
//! the byte length of the most recent render and pre-sizes the next render's
//! `String` to that (plus a small margin), so a *warm* template reallocates at
//! most once however large the data — the same trick Sailfish uses to win the
//! `big-table` benchmark. The hint is seeded with the compiler's compile-time
//! literal estimate, so the very first (cold) render behaves as before.
//!
//! It is purely a performance hint: it sizes the buffer, never the output, so it
//! cannot affect a render's bytes. Loads/stores use `Relaxed` ordering — a race
//! between concurrent renders can only yield a slightly-off capacity, never a
//! data race or UB (this crate stays `#![forbid(unsafe_code)]`).

use core::sync::atomic::{AtomicUsize, Ordering};

/// A per-template, render-to-render output-size hint. See the module docs.
#[derive(Debug)]
pub struct SizeHint {
    /// The byte length of the most recent render (or the compile-time seed).
    last: AtomicUsize,
}

impl SizeHint {
    /// Create a hint seeded with the compiler's compile-time literal estimate.
    #[must_use]
    pub const fn new(seed: usize) -> Self {
        Self {
            last: AtomicUsize::new(seed),
        }
    }

    /// The capacity to pre-allocate for the next render: the last render's length
    /// plus a ~1/8 margin (and a small floor), so a modest upward drift in size
    /// still avoids a reallocation.
    #[must_use]
    pub fn suggest(&self) -> usize {
        let n = self.last.load(Ordering::Relaxed);
        n + n / 8 + 16
    }

    /// Record the byte length this render actually produced. Call once, at the end
    /// of `render`, with `out.len()`.
    pub fn record(&self, len: usize) {
        self.last.store(len, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::SizeHint;

    #[test]
    fn suggest_seeds_then_learns_with_margin() {
        let h = SizeHint::new(100);
        // Cold: seed + 1/8 + 16.
        assert_eq!(h.suggest(), 100 + 12 + 16);
        // After a large render, the next suggestion tracks it.
        h.record(80_000);
        assert_eq!(h.suggest(), 80_000 + 10_000 + 16);
        // The margin guarantees the suggestion always covers the same-size render.
        assert!(h.suggest() >= 80_000);
    }

    #[test]
    fn record_is_idempotent_on_value() {
        let h = SizeHint::new(0);
        h.record(42);
        h.record(42);
        assert_eq!(h.suggest(), 42 + 42 / 8 + 16);
    }
}
