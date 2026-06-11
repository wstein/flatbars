//! A minimal Zola-style static-site harness over Trussbars (northstar, docs/24).
//!
//! The pipeline is host-side — the logic-less split: a content file is split into TOML
//! front-matter + a Markdown body; the body renders to HTML (`pulldown-cmark`); the
//! result fills a **typed** context; a `truss!`-compiled render fn (parse → desugar →
//! emit → straight-line Rust, `#![forbid(unsafe_code)]`) produces the page. Tera's
//! `get_url`/`date` realize as **typed host helpers**; `markdown` is this precompute
//! (the body → `| safe` HTML in the context); inheritance is the ADR-040 surface. No
//! Zola fork — a theme + this harness.

use pulldown_cmark::{Options, Parser, html};
use serde::Deserialize;
use trussbars_macros::truss;

// ── host helpers — the Tera-filter equivalents (docs/24) ─────────────────────────

/// `get_url(path)` — resolve an internal content path to its permalink. A real harness
/// threads the rendered site index; here, slugify the path.
fn get_url(path: &str) -> String {
    match path {
        "@/_index.md" => "/".to_string(),
        p => format!("/{}/", p.trim_start_matches("@/").trim_end_matches(".md")),
    }
}

/// `date(value, fmt)` — format an ISO date. A real harness uses `chrono`; this stub
/// renders `2026-06-11` as `Jun 11, 2026` (the `fmt` is taken for shape).
fn date(value: &str, _fmt: &str) -> String {
    const M: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    match value.split('-').collect::<Vec<_>>().as_slice() {
        [y, m, d] => {
            let mi = m.parse::<usize>().unwrap_or(1).clamp(1, 12) - 1;
            format!("{} {}, {}", M[mi], d.trim_start_matches('0'), y)
        }
        _ => value.to_string(),
    }
}

// ── typed context ────────────────────────────────────────────────────────────────

/// A single rendered post: front-matter fields + the Markdown body pre-rendered to HTML.
#[derive(trussbars_core::Trussbars)]
pub struct Post {
    title: String,
    date: String,
    /// Markdown rendered to HTML by the harness — emitted with `| safe`.
    body_html: String,
}

/// A post as it appears in the index listing.
#[derive(trussbars_core::Trussbars)]
pub struct PostRef {
    title: String,
    date: String,
    slug: String,
}

/// The index page context.
#[derive(trussbars_core::Trussbars)]
pub struct Index {
    posts: Vec<PostRef>,
}

// ── templates (ported, Zola-style) ───────────────────────────────────────────────
//
// A `base` layout with `{% block %}` slots; `post` / `index` `{% extends %}` it.
// The base is repeated per `truss!` (each template compiles independently); a real
// theme port shares it via a `.truss` file + cross-file partials (`partials = [..]`).

truss!(
    render_post,
    Post,
    r#"{% inline "base" %}<!DOCTYPE html><html><head><title>{% block title %}{% endblock %} · Trussbars</title></head><body><nav><a href="{{ get_url "@/_index.md" }}">Home</a></nav><main>{% block main %}{% endblock %}</main></body></html>{% endinline %}{% extends "base" %}{% block title %}{{title}}{% endblock %}{% block main %}<article><h1>{{title}}</h1><time>{{ date | date "%b %d, %Y" }}</time>{{ body_html | safe }}</article>{% endblock %}"#,
    helpers = [get_url, date]
);

truss!(
    render_index,
    Index,
    r#"{% inline "base" %}<!DOCTYPE html><html><head><title>{% block title %}{% endblock %} · Trussbars</title></head><body><nav><a href="{{ get_url "@/_index.md" }}">Home</a></nav><main>{% block main %}{% endblock %}</main></body></html>{% endinline %}{% extends "base" %}{% block title %}Home{% endblock %}{% block main %}<ul>{% for posts %}<li><a href="{{ get_url slug }}">{{title}}</a> — <time>{{ date | date "%b %d, %Y" }}</time></li>{% endfor %}</ul>{% endblock %}"#,
    helpers = [get_url, date]
);

// ── the content pipeline ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct FrontMatter {
    title: String,
    date: String,
}

/// Split a Zola-style `+++ TOML +++` front-matter from the Markdown body.
fn split_frontmatter(src: &str) -> (FrontMatter, String) {
    let s = src.trim_start();
    let rest = s
        .strip_prefix("+++")
        .expect("content needs `+++` TOML front-matter");
    let end = rest.find("+++").expect("unterminated `+++` front-matter");
    let fm: FrontMatter = toml::from_str(rest[..end].trim()).expect("invalid TOML front-matter");
    (fm, rest[end + 3..].trim_start().to_string())
}

/// CommonMark → HTML (the `markdown` precompute step).
fn md_to_html(md: &str) -> String {
    let mut out = String::new();
    html::push_html(&mut out, Parser::new_ext(md, Options::empty()));
    out
}

/// Render one content file (front-matter + Markdown) to a full HTML page.
pub fn build_post(content: &str) -> String {
    let (fm, body_md) = split_frontmatter(content);
    render_post(&Post {
        title: fm.title,
        date: fm.date,
        body_html: md_to_html(&body_md),
    })
}

/// Render the index from `(slug, content)` files, preserving the given order.
pub fn build_index(contents: &[(&str, &str)]) -> String {
    let posts = contents
        .iter()
        .map(|(slug, content)| {
            let (fm, _) = split_frontmatter(content);
            PostRef {
                title: fm.title,
                date: fm.date,
                slug: format!("@/{slug}.md"),
            }
        })
        .collect();
    render_index(&Index { posts })
}

#[cfg(test)]
mod tests {
    use super::*;

    const HELLO: &str = include_str!("../content/2026-06-11-hello.md");
    const NOTES: &str = include_str!("../content/2026-06-09-notes.md");

    #[test]
    fn renders_a_post_end_to_end() {
        let html = build_post(HELLO);
        // inheritance: base layout filled by the post.
        assert!(html.starts_with("<!DOCTYPE html>"));
        assert!(html.contains("<title>Hello, Trussbars · Trussbars</title>"));
        // host helpers: get_url (nav) + date (formatted).
        assert!(html.contains(r#"<a href="/">Home</a>"#));
        assert!(html.contains("<time>Jun 11, 2026</time>"));
        // markdown precompute → HTML, spliced raw via `| safe`.
        assert!(html.contains("<strong>first post</strong>"));
        assert!(html.contains("<h2>Why</h2>"));
    }

    #[test]
    fn renders_the_index_list() {
        let html = build_index(&[("2026-06-11-hello", HELLO), ("2026-06-09-notes", NOTES)]);
        assert!(html.contains(r#"<a href="/2026-06-11-hello/">Hello, Trussbars</a>"#));
        assert!(html.contains(r#"<a href="/2026-06-09-notes/">Field notes</a>"#));
        assert!(html.contains("<time>Jun 9, 2026</time>"));
    }
}
