//! The VM hot-reload demo (docs/24): render a layout + page through the bytecode VM, then *edit
//! the template files of the running process* and re-render — no `cargo build` between frames.
//!
//! Two modes:
//! - **default** (`cargo run`): a scripted edit session over a temp scratch dir — render, rewrite
//!   a template, render again — proving the VM recompiled the new source in-process. Deterministic
//!   (this is what CI runs through the tests).
//! - **`--watch [dir]`** (`cargo run -- --watch`): a live filesystem watcher (the `notify` crate).
//!   Edit `layout.truss` / `page.truss` in `dir` (a seeded scratch dir if omitted) in your editor
//!   and every save re-renders. Runs until Ctrl-C.

use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::time::Duration;

use trussbars_interp::Value;
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
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("--watch") => run_watch(args.next().map(PathBuf::from)),
        _ => scripted_demo(),
    }
}

/// The deterministic demo: seed a scratch dir, render, edit the page, edit the shared base, render
/// after each — all in one process, no rebuild.
fn scripted_demo() {
    let dir = seed_scratch("demo").expect("create scratch templates dir");
    let reloader = Reloader::new(&dir);
    let data = demo_data();

    frame(
        "v1 — initial templates (page extends layout)",
        &reloader,
        &data,
    );

    // A user edits page.truss. The running process re-reads + recompiles via the VM on the next
    // render — no rebuild. This is exactly what a compile-time `truss!` binary can't do.
    std::fs::write(dir.join("page.truss"), EDITED_PAGE).expect("edit page.truss");
    frame(
        "v2 — page.truss edited (added a tagline), same process",
        &reloader,
        &data,
    );

    // Now edit the shared *layout*: the page that extends it reflows — one base, every page.
    std::fs::write(dir.join("layout.truss"), EDITED_LAYOUT).expect("edit layout.truss");
    frame(
        "v3 — layout.truss edited (footer): the cross-file base",
        &reloader,
        &data,
    );

    std::fs::remove_dir_all(&dir).ok();
    println!("\nThree renders, one running process, zero Rust rebuilds.");
    println!("Tip: `cargo run -- --watch` to re-render live as you edit the files yourself.");
}

/// The opt-in live mode: watch `dir` (a seeded scratch dir if none given) and re-render on every
/// save. The injection boundary is unchanged — the template is host-trusted source on disk, only
/// the *data* would ever come from elsewhere.
fn run_watch(dir: Option<PathBuf>) {
    use notify::{RecursiveMode, Watcher};

    let dir = dir.unwrap_or_else(|| {
        let d = seed_scratch("watch").expect("seed scratch templates");
        println!("seeded editable templates in {}", d.display());
        d
    });
    let reloader = Reloader::new(&dir);
    let data = demo_data();

    println!(
        "watching {} — edit layout.truss / page.truss and save (Ctrl-C to stop)",
        dir.display()
    );
    frame("initial", &reloader, &data);

    // `notify` implements its event handler for an mpsc Sender, so the watcher pushes results
    // straight onto the channel this loop drains.
    let (tx, rx) = channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(tx).expect("create file watcher");
    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .expect("watch templates dir");

    while let Ok(event) = rx.recv() {
        if let Err(e) = event {
            eprintln!("watch error: {e}");
            continue;
        }
        // One editor save often fires a burst of events; let it settle, drain, render once.
        std::thread::sleep(Duration::from_millis(40));
        while rx.try_recv().is_ok() {}
        frame("re-rendered on save", &reloader, &data);
    }
}

fn demo_data() -> Value {
    page_context("Trussbars Times", "Hello", &["first post", "second post"])
}

fn frame(label: &str, reloader: &Reloader, data: &Value) {
    println!("\n── {label} ──");
    match reloader.render(data) {
        Ok(html) => println!("{html}"),
        Err(e) => println!("(render error: {e})"),
    }
}
