//! A tiny **VM hot-reload** demo (northstar, docs/24): render cross-file `.truss` templates
//! through the bytecode VM, re-reading + recompiling them from disk on every render — so editing
//! a template changes the output of a *running* process, with no Rust rebuild.
//!
//! This is the thing the AOT path (`truss!`) structurally can't do: there the template source is
//! baked into the binary at compile time. The VM's [`Program::compile_with_partials`] takes the
//! template *and* its imported partials as runtime strings, so a layout + page split stays
//! reloadable. A live site or a template editor renders this way — the data shape and the template
//! text are both known only at run time.
//!
//! [`Reloader`] is the whole pattern: hold a templates directory, and on each [`render`] read the
//! current `layout.truss` + `page.truss` and recompile. Swap the files and the next render
//! reflects them. ([`render`]: Reloader::render)

use std::fs;
use std::path::{Path, PathBuf};

use trussbars_interp::Value;
use trussbars_vm::Program;

/// A reloadable view over a templates directory holding a `layout.truss` base and a `page.truss`
/// that `{% extends "layout" %}`. Each [`Reloader::render`] re-reads both files and recompiles via
/// the VM, so a long-running host always renders the *current* template source on disk.
pub struct Reloader {
    dir: PathBuf,
}

impl Reloader {
    /// View the templates in `dir`.
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// Read the current `page.truss` + `layout.truss`, compile the page against the layout (the
    /// VM's cross-file `compile_with_partials`), and render against `data`. A fresh recompile each
    /// call — that *is* the hot-reload: no cached `Program`, so an edit on disk takes effect on the
    /// very next render.
    ///
    /// # Errors
    /// A read error (missing file) or a parse/compile error in either template (so a broken edit
    /// surfaces a message instead of crashing the host).
    pub fn render(&self, data: &Value) -> Result<String, String> {
        let page = read(&self.dir, "page.truss")?;
        let layout = read(&self.dir, "layout.truss")?;
        let prog = Program::compile_with_partials(&page, &[("layout".to_string(), layout)])?;
        prog.render(data)
    }
}

fn read(dir: &Path, name: &str) -> Result<String, String> {
    fs::read_to_string(dir.join(name)).map_err(|e| format!("read {name}: {e}"))
}

/// The demo's page context — `{ site, title, posts: [{ name }] }` — built directly (the headline
/// is reloading *templates*, so the data needs no serde dep).
pub fn page_context(site: &str, title: &str, posts: &[&str]) -> Value {
    use std::collections::BTreeMap;
    use std::rc::Rc;

    let s = |t: &str| Value::Str(Rc::from(t));
    let posts: Vec<Value> = posts
        .iter()
        .map(|p| {
            let mut m = BTreeMap::new();
            m.insert("name".to_string(), s(p));
            Value::Object(Rc::new(m))
        })
        .collect();
    let mut m = BTreeMap::new();
    m.insert("site".to_string(), s(site));
    m.insert("title".to_string(), s(title));
    m.insert("posts".to_string(), Value::Array(Rc::from(posts)));
    Value::Object(Rc::new(m))
}

/// The starting templates (this crate's `templates/*.truss`), baked in so the demo can seed a
/// scratch dir without locating the source tree at run time.
const LAYOUT: &str = include_str!("../templates/layout.truss");
const PAGE: &str = include_str!("../templates/page.truss");

/// Create (or reset) a uniquely-labelled scratch directory under the system temp dir and seed it
/// with the starting `layout.truss` + `page.truss`. The host edits files *here*, leaving the
/// repo's committed `templates/` pristine.
///
/// # Errors
/// A filesystem error creating the directory or writing the seed files.
pub fn seed_scratch(label: &str) -> std::io::Result<PathBuf> {
    let dir = std::env::temp_dir().join(format!("trussbars-vm-hotreload-{label}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir)?;
    fs::write(dir.join("layout.truss"), LAYOUT)?;
    fs::write(dir.join("page.truss"), PAGE)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh empty scratch dir for a test (distinct label → no collision under `cargo test`'s
    /// thread parallelism).
    fn fresh(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("trussbars-vm-hotreload-test-{label}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn hot_edit_of_the_page_changes_a_running_render() {
        let dir = fresh("page-edit");
        fs::write(
            dir.join("layout.truss"),
            "<main>{% block body %}{% endblock %}</main>",
        )
        .unwrap();
        fs::write(
            dir.join("page.truss"),
            r#"{% extends "layout" %}{% block body %}v1:{{site}}{% endblock %}"#,
        )
        .unwrap();

        let r = Reloader::new(&dir);
        let data = page_context("S", "T", &[]);
        assert_eq!(r.render(&data).unwrap(), "<main>v1:S</main>");

        // The "hot" edit: same `Reloader`, same process — only the file changed.
        fs::write(
            dir.join("page.truss"),
            r#"{% extends "layout" %}{% block body %}v2:{{site}}{% endblock %}"#,
        )
        .unwrap();
        assert_eq!(r.render(&data).unwrap(), "<main>v2:S</main>");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn editing_the_layout_reflows_the_extending_page() {
        // The cross-file angle: the edit is to the *base*, and the page that `{% extends %}` it
        // picks the change up — one shared layout, many pages.
        let dir = fresh("layout-edit");
        fs::write(
            dir.join("layout.truss"),
            "<a>{% block body %}{% endblock %}</a>",
        )
        .unwrap();
        fs::write(
            dir.join("page.truss"),
            r#"{% extends "layout" %}{% block body %}{{site}}{% endblock %}"#,
        )
        .unwrap();

        let r = Reloader::new(&dir);
        let data = page_context("S", "T", &[]);
        assert_eq!(r.render(&data).unwrap(), "<a>S</a>");

        fs::write(
            dir.join("layout.truss"),
            "<b>{% block body %}{% endblock %}</b>",
        )
        .unwrap();
        assert_eq!(r.render(&data).unwrap(), "<b>S</b>");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_seeded_demo_templates_render() {
        let dir = seed_scratch("seed-test").unwrap();
        let out = Reloader::new(&dir)
            .render(&page_context("Times", "Hello", &["a", "b"]))
            .unwrap();
        assert!(out.contains("<title>Hello · Times</title>"), "{out}"); // page overrides title
        assert!(out.contains("<header>Times</header>"), "{out}"); // base header
        assert!(out.contains("<h1>Hello</h1>"), "{out}"); // body override
        assert!(
            out.contains("<li>a</li>") && out.contains("<li>b</li>"),
            "{out}"
        ); // the for-loop
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_broken_edit_is_a_recoverable_error_not_a_panic() {
        let dir = fresh("broken-edit");
        fs::write(dir.join("layout.truss"), "{% block body %}{% endblock %}").unwrap();
        fs::write(
            dir.join("page.truss"),
            r#"{% extends "layout" %}{% block body %}{% for x in %}{% endblock %}"#,
        )
        .unwrap();
        let err = Reloader::new(&dir)
            .render(&page_context("S", "T", &[]))
            .expect_err("a malformed template should error, not render");
        assert!(!err.is_empty(), "{err}");
        fs::remove_dir_all(&dir).ok();
    }
}
