//! The render function, compiled from `templates/changelog.truss` at build time by
//! the `truss!` proc-macro — the native Trussbars v2 front-end (no PureScript step).
//! `truss!` reads the `.truss` file (relative to the crate root), compiles it to a
//! typed `pub fn render_changelog(ctx: &ChangelogCtx) -> String`, and tracks the
//! file so a template edit re-triggers the build.
use crate::context::ChangelogCtx;
use trussbars_macros::truss;

truss!(render_changelog, ChangelogCtx, path = "templates/changelog.truss");
