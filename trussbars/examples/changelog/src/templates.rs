//! The render function, compiled from `templates/changelog.truss` at build time by
//! the `truss!` proc-macro. The template calls the F3 host helper `date` (from
//! `trussbars-i18n`), declared in the per-call `helpers = [date]` allow-list.
use crate::context::ChangelogCtx;
use trussbars_i18n::date;
use trussbars_macros::truss;

truss!(
    render_changelog,
    ChangelogCtx,
    path = "templates/changelog.truss",
    helpers = [date]
);
