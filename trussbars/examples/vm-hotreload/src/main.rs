//! The VM hot-reload demo (docs/24): render a layout + page through the bytecode VM, then *edit
//! the template files of the running process* and re-render — no `cargo build` between frames.
//!
//! It seeds a scratch dir from the committed `templates/`, renders, rewrites a template, and
//! renders again from the same `Reloader`. The output changes because the VM recompiled the new
//! source on the spot — the runtime-template capability the AOT path doesn't have.

use std::fs;

use trussbars_vm_hotreload::{Reloader, page_context, seed_scratch};

/// `page.truss` after a content edit — a tagline line added under the `<h1>`.
const EDITED_PAGE: &str = "{% extends \"layout\" %}\n\
{% block title %}{{ title }} · {{ site }}{% endblock %}\n\
{% block body %}\n\
<h1>{{ title }}</h1>\n\
<p class=\"tagline\">Now with hot reload.</p>\n\
<ul>\n\
{% for post in posts %}<li>{{ post.name }}</li>\n\
{% endfor %}</ul>\n\
{% endblock %}\n";

/// `layout.truss` after a chrome edit — a footer added to the shared base. Every page that
/// `{% extends %}` it inherits the change.
const EDITED_LAYOUT: &str = "<!DOCTYPE html>\n\
<html>\n\
<head><title>{% block title %}{{ site }}{% endblock %}</title></head>\n\
<body>\n\
<header>{{ site }}</header>\n\
{% block body %}{% endblock %}\n\
<footer>© {{ site }}</footer>\n\
</body>\n\
</html>\n";

fn main() {
    let dir = seed_scratch("demo").expect("create scratch templates dir");
    let reloader = Reloader::new(&dir);
    let data = page_context("Trussbars Times", "Hello", &["first post", "second post"]);

    frame(
        "v1 — initial templates (page extends layout)",
        &reloader,
        &data,
    );

    // A user edits page.truss. The running process re-reads + recompiles via the VM on the next
    // render — no rebuild. This is exactly what a compile-time `truss!` binary can't do.
    fs::write(dir.join("page.truss"), EDITED_PAGE).expect("edit page.truss");
    frame(
        "v2 — page.truss edited (added a tagline), same process",
        &reloader,
        &data,
    );

    // Now edit the shared *layout*: the page that extends it reflows — one base, every page.
    fs::write(dir.join("layout.truss"), EDITED_LAYOUT).expect("edit layout.truss");
    frame(
        "v3 — layout.truss edited (footer): the cross-file base",
        &reloader,
        &data,
    );

    fs::remove_dir_all(&dir).ok();
    println!("\nThree renders, one running process, zero Rust rebuilds.");
}

fn frame(label: &str, reloader: &Reloader, data: &trussbars_interp::Value) {
    println!("\n── {label} ──");
    match reloader.render(data) {
        Ok(html) => println!("{html}"),
        Err(e) => println!("(render error: {e})"),
    }
}
