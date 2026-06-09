//! A small but realistic blog rendered entirely by Trussbars-compiled templates —
//! a dogfood of the engine + runtime to find ergonomics gaps (see README).
//!
//! `templates.rs` compiles `templates/*.truss` at build time via the native
//! `truss!` proc-macro (loaded from each file with `path = …`); this crate just
//! supplies the typed context and sample data.

pub mod context;
pub mod templates;

use context::{Post, Site};

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
            body_html: "<p>Templates are <em>just</em> functions.</p>".into(),
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
            body_html: "<p>No data may choose <strong>code</strong>.</p>".into(),
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
            body_html: "<p>The residual gap is <code>unsafe</code>.</p>".into(),
            tags: vec!["Performance".into()],
            views: 503.0,
            year: 2025,
        },
    ]
}
