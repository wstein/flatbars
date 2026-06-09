//! The render functions, compiled from `templates/*.truss` at build time by the
//! `truss!` proc-macro. `post.truss` calls two F3 host helpers — `date` (from
//! `trussbars-i18n`) and the crate-local `markdown` (a `Safe`-returning renderer) —
//! declared in its per-call `helpers = […]` allow-list.
use crate::context::{ArchiveCtx, IndexCtx, PostCtx};
use crate::markdown;
use trussbars_i18n::date;
use trussbars_macros::truss;

truss!(render_index, IndexCtx, path = "templates/index.truss");
truss!(
    render_post,
    PostCtx,
    path = "templates/post.truss",
    helpers = [date, markdown]
);
truss!(render_archive, ArchiveCtx, path = "templates/archive.truss");
