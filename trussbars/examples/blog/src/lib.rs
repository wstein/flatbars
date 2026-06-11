//! A small but realistic blog rendered entirely by Trussbars-compiled templates —
//! a dogfood of the engine + runtime to find ergonomics gaps (see README).
//!
//! `templates.rs` compiles `templates/*.truss` at build time via the native
//! `truss!` proc-macro (loaded from each file with `path = …`); this crate supplies
//! the typed context, sample data, and the host helpers the templates call (F3): a
//! `date` formatter from `trussbars-i18n`, and a local `markdown` that returns
//! `Safe` markup (so `{{post.body | markdown}}` emits unescaped without a `| safe` pipe).

pub mod context;
pub mod templates;

use context::{Post, Site};
use trussbars_core::Safe;

/// Render a tiny inline-Markdown subset to safe HTML (the blog's F3 `markdown` host
/// helper). The source text is HTML-escaped first, then `**strong**`, `*em*`, and
/// `` `code` `` are converted to their tags and the whole is wrapped in a paragraph.
/// Returns [`Safe`], so a `{{ … | markdown }}` tag emits it unescaped.
#[must_use]
pub fn markdown(src: &str) -> Safe {
    let mut escaped = String::new();
    trussbars_core::escape_html(src, &mut escaped);
    let strong = wrap_pairs(&escaped, "**", "<strong>", "</strong>");
    let em = wrap_pairs(&strong, "*", "<em>", "</em>");
    let code = wrap_pairs(&em, "`", "<code>", "</code>");
    Safe(format!("<p>{code}</p>"))
}

/// Replace each *pair* of `delim` with `open` … `close` (the first opens, the next
/// closes, and so on) — the inline-Markdown emphasis rule, regex-free.
fn wrap_pairs(s: &str, delim: &str, open: &str, close: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    let mut opening = true;
    while let Some(i) = rest.find(delim) {
        out.push_str(&rest[..i]);
        out.push_str(if opening { open } else { close });
        opening = !opening;
        rest = &rest[i + delim.len()..];
    }
    out.push_str(rest);
    out
}

/// The site header.
pub fn sample_site() -> Site {
    Site {
        title: "Truss & Bars".into(),
    }
}

/// A fixed set of posts (two years, varied tags and view counts).
pub fn sample_posts() -> Vec<Post> {
    vec![
        Post {
            slug: "hello-trussbars".into(),
            title: "Hello, Trussbars".into(),
            author: "Ada".into(),
            date: "2024-01-12".into(),
            excerpt: "Why a template <engine> can be a compiler.".into(),
            body: "Templates are *just* functions.".into(),
            tags: vec!["Intro".into(), "Rust".into()],
            views: 1240.0,
            year: 2024,
        },
        Post {
            slug: "names-static-data-dynamic".into(),
            title: "Names static, data dynamic".into(),
            author: "Bertrand".into(),
            date: "2024-06-03".into(),
            excerpt: "The injection-safety boundary, drawn in the type system.".into(),
            body: "No data may choose **code**.".into(),
            tags: vec!["Design".into(), "Security".into()],
            views: 87.0,
            year: 2024,
        },
        Post {
            slug: "at-the-safe-ceiling".into(),
            title: "At the safe-Rust ceiling".into(),
            author: "Ada".into(),
            date: "2025-02-20".into(),
            excerpt: "How we got within 2x of an unsafe engine — and stopped.".into(),
            body: "The residual gap is `unsafe`.".into(),
            tags: vec!["Performance".into()],
            views: 503.0,
            year: 2025,
        },
    ]
}
