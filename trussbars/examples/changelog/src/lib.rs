//! A self-hosted changelog: render this repo's own conventional commits (a
//! committed `git log` snapshot) through a Trussbars-compiled `.truss` template.
//!
//! It is a *deliberately* thin template over a *fat* host precompute. Everything
//! `parse_commit` does below — split the `type(scope): subject` prefix, shorten the
//! hash, truncate the date — is work the template cannot express today (no host
//! helpers, no `date`/string-machinery in a condition). That pile is the concrete
//! requirements list for the v2 host-helper convention (gap F3); see the README.

pub mod context;
pub mod templates;

use context::{ChangelogCtx, Commit};

/// Build the context from the committed `data/git-log.txt` snapshot — one
/// `<full-hash>|<iso-date>|<subject>` line per commit.
pub fn changelog() -> ChangelogCtx {
    let raw = include_str!("../data/git-log.txt");
    let commits = raw
        .lines()
        .filter(|l| !l.is_empty())
        .map(parse_commit)
        .collect();
    ChangelogCtx {
        project: "Trussbars".into(),
        commits,
    }
}

/// Parse one log line into a typed [`Commit`]. **This is the F3 evidence**: the
/// categorisation, scope extraction, hash shortening, and date truncation all live
/// here because a `.truss` template can do none of them.
fn parse_commit(line: &str) -> Commit {
    let mut parts = line.splitn(3, '|');
    let hash = parts.next().unwrap_or_default();
    let iso = parts.next().unwrap_or_default();
    let subject = parts.next().unwrap_or_default();

    // "type(scope): message"  or  "type: message"
    let (prefix, message) = subject.split_once(": ").unwrap_or((subject, ""));
    let (category, scope) = match prefix.split_once('(') {
        Some((cat, rest)) => (cat, rest.trim_end_matches(')')),
        None => (prefix, ""),
    };

    Commit {
        category: category.to_string(),
        scope: scope.to_string(),
        subject: message.to_string(),
        hash: hash.chars().take(7).collect(),
        date: iso.chars().take(10).collect(),
    }
}
