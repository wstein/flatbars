//! The typed host context for the blog.
//!
//! Two Trussbars facts show up directly in these types:
//!
//! 1. **Field names are static** — `{{post.body_html}}` resolves to the Rust field
//!    `post.body_html` verbatim (no rename layer). So templates use snake_case to
//!    keep the Rust idiomatic; there is no `serde`-style `#[rename]` for paths.
//! 2. **Numbers are `f64`** — a field compared against a numeric literal (`{{#if
//!    views > 100}}`) is emitted as `views > 100.0`, so `views` must be `f64`
//!    (`i64 > f64` would not type-check). Counters that are *only* printed or used
//!    as a `groupBy` key (like `year`) can stay `i64`.

/// Site-wide metadata.
pub struct Site {
    pub title: String,
}

/// One post. Field names match the template paths exactly.
pub struct Post {
    pub slug: String,
    pub title: String,
    pub author: String,
    /// Pre-formatted — there is no `date` helper in v1 (see the README gap list).
    pub date: String,
    pub excerpt: String,
    /// Pre-rendered markup, emitted unescaped via `{{{ post.body_html }}}`.
    pub body_html: String,
    pub tags: Vec<String>,
    /// `f64` because the template compares it to a numeric literal.
    pub views: f64,
    /// `i64` — only ever stringified as a `groupBy` key.
    pub year: i64,
}

/// Context for `index.truss`.
pub struct IndexCtx {
    pub site: Site,
    pub posts: Vec<Post>,
}

/// Context for `post.truss`.
pub struct PostCtx {
    pub post: Post,
}

/// Context for `archive.truss`.
pub struct ArchiveCtx {
    pub site: Site,
    pub posts: Vec<Post>,
}
