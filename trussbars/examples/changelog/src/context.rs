//! Typed context for the changelog. **Every field is precomputed by the host**
//! (`lib.rs::parse_commit`) — the template only renders already-typed strings.
//! That precompute pile *is* the finding: see the README's F3 list (the work a
//! `.truss` template cannot do today, hence the v2 host-helper case).

/// One parsed conventional commit.
pub struct Commit {
    /// `feat` / `fix` / `docs` / `perf` / `test` … — parsed from the subject prefix.
    pub category: String,
    /// `trussbars-core` etc.; empty when the commit had no `(scope)`.
    pub scope: String,
    /// The message after `type(scope): `.
    pub subject: String,
    /// Short hash (7 chars).
    pub hash: String,
    /// `YYYY-MM-DD` (the ISO timestamp, truncated).
    pub date: String,
}

/// The whole changelog context.
pub struct ChangelogCtx {
    pub project: String,
    pub commits: Vec<Commit>,
}
