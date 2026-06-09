//! A self-hosted changelog: render this repo's own conventional commits (a
//! committed `git log` snapshot) through a Trussbars-compiled `.truss` template.
//!
//! A thin template over a host precompute. `parse_commit` still splits the
//! `type(scope): subject` prefix and shortens the hash (a template can't pattern-match
//! a prefix), but **date formatting now lives in the template** via the F3 host helper
//! `{{date c.date "%Y-%m-%d"}}` (`trussbars_i18n::date`, declared with
//! `#[truss_helpers]`) — dogfooding the host-helper convention that closed gap F3.

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

/// Parse one log line into a typed [`Commit`]. The categorisation, scope extraction,
/// and hash shortening still live here (the template can't pattern-match a prefix),
/// but **the date is no longer truncated here** — the raw ISO timestamp is carried
/// through and the template formats it with the F3 host helper `{{date c.date
/// "%Y-%m-%d"}}` (`trussbars_i18n::date`), closing that part of F3.
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
        date: iso.to_string(),
    }
}
