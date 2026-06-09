//! The render functions, compiled from `templates/*.truss` at build time by the
//! `truss!` proc-macro — the native Trussbars v2 front-end (no PureScript step).
//! Each `truss!` reads its `.truss` file (relative to the crate root), compiles it
//! to a typed `pub fn render_*(ctx: &Ctx) -> String`, and tracks the file so a
//! template edit re-triggers the build.
use crate::context::{ArchiveCtx, IndexCtx, PostCtx};
use trussbars_macros::truss;

truss!(render_index, IndexCtx, path = "templates/index.truss");
truss!(render_post, PostCtx, path = "templates/post.truss");
truss!(render_archive, ArchiveCtx, path = "templates/archive.truss");
