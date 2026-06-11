//! A minimal Zola-style static-site harness over Trussbars (northstar, docs/24) —
//! porting the **Hyde** theme (`getzola/hyde`: `templates/index.html` is the base
//! layout + a default post-list `content` block; `page.html` `{% extends %}` it).
//!
//! The pipeline is host-side — the logic-less split: a content file is split into TOML
//! front-matter + a Markdown body; the body renders to HTML (`pulldown-cmark`); the
//! result fills a **typed** context (`Config`/`Section`/`Page`, deserialized from a Zola
//! `config.toml`); a `truss!`-compiled render fn (parse → desugar → emit → straight-line
//! Rust, `#![forbid(unsafe_code)]`) produces the page. Tera's `get_url`/`date` realize as
//! typed host helpers; `markdown` is precompute → `{{ page.content | safe }}`;
//! `{% extends %}`/`{% block %}` are the ADR-040 surface. No Zola fork — Hyde's templates
//! ported to `.truss`, this harness, the engine.

use pulldown_cmark::{Options, Parser, html};
use serde::Deserialize;
use trussbars_macros::truss;

// ── host helpers — the Tera-filter equivalents (docs/24) ─────────────────────────

/// `get_url(path)` — a content path `@/x.md` → its permalink `/x/`; a static asset →
/// `/asset`. A real harness threads Zola's rendered link index.
fn get_url(path: &str) -> String {
    match path.strip_prefix("@/") {
        Some(p) => format!("/{}/", p.trim_end_matches(".md")),
        None => format!("/{path}"),
    }
}

/// `date(value, fmt)` — format an ISO date. A real harness uses `chrono`; this stub
/// passes `%Y-%m-%d` through (Hyde's format) and renders a long form otherwise.
fn date(value: &str, fmt: &str) -> String {
    if fmt == "%Y-%m-%d" {
        return value.to_string();
    }
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

// ── typed context (mirrors Hyde's `config.*` / `section.pages` / `page.*` usage) ──

/// A sidebar nav link (`config.extra.hyde_links[]`).
#[derive(Deserialize, Clone, trussbars_core::Trussbars)]
pub struct Link {
    url: String,
    name: String,
}

/// The theme-specific `[extra]` table.
#[derive(Deserialize, Clone, trussbars_core::Trussbars)]
pub struct Extra {
    hyde_theme: String,
    hyde_reverse: bool,
    hyde_sticky: bool,
    hyde_links: Vec<Link>,
}

/// The Zola site `config.toml`.
#[derive(Deserialize, Clone, trussbars_core::Trussbars)]
pub struct Config {
    title: String,
    base_url: String,
    description: String,
    generate_feed: bool,
    feed_filename: String,
    extra: Extra,
}

/// A post in the index listing (`section.pages[]`).
#[derive(trussbars_core::Trussbars)]
pub struct PageMeta {
    permalink: String,
    title: String,
    date: String,
}

/// The section whose `pages` the index lists.
#[derive(trussbars_core::Trussbars)]
pub struct Section {
    pages: Vec<PageMeta>,
}

/// A single rendered page (`page.*` in the overridden `content` block).
#[derive(trussbars_core::Trussbars)]
pub struct Page {
    title: String,
    date: String,
    /// Markdown rendered to HTML by the harness — emitted with `| safe`.
    content: String,
}

/// The index page context (Hyde's `index.html`, default `content` block).
#[derive(trussbars_core::Trussbars)]
pub struct IndexCtx {
    lang: String,
    config: Config,
    section: Section,
}

/// A single-page context (Hyde's `page.html`).
#[derive(trussbars_core::Trussbars)]
pub struct PageCtx {
    lang: String,
    config: Config,
    page: Page,
}

// ── templates: Hyde's, ported to .truss ──────────────────────────────────────────
//
// `index.html` IS the base layout, so the index renders it directly. `page.html`
// extends it — and because a cross-file partial cannot yet be an `{% extends %}` base
// (the engine gap this port surfaced, docs/24), hyde_page.truss inlines the base.

truss!(
    render_index,
    IndexCtx,
    path = "templates/hyde_base.truss",
    helpers = [get_url, date]
);

// `render_page` inlines the base (`{% inline "hyde" %}`) in hyde_page.truss itself —
// see the note there: a cross-file partial cannot yet be an `{% extends %}` base.
truss!(
    render_page,
    PageCtx,
    path = "templates/hyde_page.truss",
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

/// Parse the site `config.toml`.
pub fn load_config(toml_src: &str) -> Config {
    toml::from_str(toml_src).expect("invalid config.toml")
}

/// Render a single content file (front-matter + Markdown) as a Hyde `page.html`.
pub fn build_page(config: Config, content: &str) -> String {
    let (fm, body_md) = split_frontmatter(content);
    render_page(&PageCtx {
        lang: "en".to_string(),
        config,
        page: Page {
            title: fm.title,
            date: fm.date,
            content: md_to_html(&body_md),
        },
    })
}

/// Render the index (Hyde `index.html`) listing `(slug, content)` posts, newest first.
pub fn build_index(config: Config, contents: &[(&str, &str)]) -> String {
    let pages = contents
        .iter()
        .map(|(slug, content)| {
            let (fm, _) = split_frontmatter(content);
            PageMeta {
                permalink: format!("/{slug}/"),
                title: fm.title,
                date: fm.date,
            }
        })
        .collect();
    render_index(&IndexCtx {
        lang: "en".to_string(),
        config,
        section: Section { pages },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: &str = include_str!("../config.toml");
    const HELLO: &str = include_str!("../content/2026-06-11-hello.md");
    const NOTES: &str = include_str!("../content/2026-06-09-notes.md");

    #[test]
    fn renders_a_hyde_page_end_to_end() {
        let html = build_page(load_config(CONFIG), HELLO);
        // base layout (sidebar) — config + the extra table + a nav link.
        assert!(html.contains(r#"<html lang="en">"#));
        assert!(html.contains("<h1>Trussbars × Hyde</h1>"));
        assert!(html.contains(r#"<body class="theme-base-08 ">"#)); // hyde_reverse=false
        assert!(html.contains(r#"<a href="/about/">About</a>"#)); // hyde_links loop
        assert!(html.contains(r#"<link rel="stylesheet" href="/poole.css">"#)); // get_url asset
        assert!(html.contains(r#"type="application/atom+xml""#)); // generate_feed + ==
        // the overridden content block — the post.
        assert!(html.contains(r#"<h1 class="post-title">Hello, Trussbars</h1>"#));
        assert!(html.contains("<strong>first post</strong>")); // markdown → HTML, raw
    }

    #[test]
    fn renders_the_hyde_index_list() {
        let html = build_index(
            load_config(CONFIG),
            &[("2026-06-11-hello", HELLO), ("2026-06-09-notes", NOTES)],
        );
        // the default `content` block: the post list with permalinks + dates.
        assert!(html.contains(r#"<a href="/2026-06-11-hello/">"#));
        assert!(html.contains("Hello, Trussbars"));
        assert!(html.contains(r#"<span class="post-date">2026-06-09</span>"#));
    }
}
