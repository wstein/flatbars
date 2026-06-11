//! Northstar spike (ADR-040/042) — the **Zola host-helper shape**, end to end.
//!
//! A Zola theme leans on Tera filters/functions (`get_url`, `date`, `markdown`) and
//! shortcodes. This proves they realize as **typed host helpers** — plain Rust fns,
//! declared once via `helpers = [..]` — plus ADR-042 inline signatures for shortcode
//! templates, all compiled by `truss!` to direct, monomorphised calls. That is the
//! logic-less, typed, injection-safe story: the *logic* (resolving a permalink,
//! formatting a date, rendering markdown) lives in the host; the template only calls.
//!
//! The helper bodies are **stubbed** (no `chrono` / `pulldown-cmark`) — the point is
//! the *shape*. A real SSG harness swaps the bodies for the actual crates and supplies
//! the site's link map; the template, the `truss!` declaration, and the types are
//! exactly what you'd ship.

use trussbars_core::Safe;
use trussbars_macros::truss;

// `get_url`: resolve an internal content path to its permalink. The host owns the
// content graph (here a fixed map; a real harness threads the rendered site index).
// A plain `String` — HTML-escaped in the `href` attribute context on output.
fn get_url(path: &str) -> String {
    match path {
        "@/about.md" => "/about/".to_string(),
        p => format!("/{}/", p.trim_start_matches("@/").trim_end_matches(".md")),
    }
}

// `date`: format an ISO date. A real harness parses + formats with `chrono`; this stub
// turns `2026-06-11` + a format into `Jun 11, 2026`. Returns `String` (escaped).
fn date(value: &str, _fmt: &str) -> String {
    const M: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    match value.split('-').collect::<Vec<_>>().as_slice() {
        [y, m, d] => {
            let mi = m.parse::<usize>().unwrap_or(1).clamp(1, 12) - 1;
            format!("{} {}, {}", M[mi], d.trim_start_matches('0'), y)
        }
        _ => value.to_string(),
    }
}

// `markdown`: render markdown → HTML. A real harness uses `pulldown-cmark`; this stub
// wraps in a paragraph. Returns `Safe`, so the HTML is spliced **raw**, not escaped —
// the injection boundary stays explicit (only a `Safe`-returning helper bypasses `esc`).
fn markdown(src: &str) -> Safe {
    Safe(format!("<p>{src}</p>"))
}

#[derive(trussbars_core::Trussbars)]
struct Page {
    title: String,
    date_iso: String,
    body: String,
}

// A Zola-style page, compiled to a typed `fn page(&Page) -> String`:
//   * inheritance — a `base` layout with `{% block %}` slots (ADR-040);
//   * the three host helpers — `get_url` (literal path arg), `date` (piped + format),
//     `markdown` (piped, `Safe` → raw);
//   * a **typed shortcode** — `{% inline "youtube" (id, w=560) %}` (ADR-042 signature:
//     required `id`, defaulted `w`), invoked with a hash argument.
truss!(
    page,
    Page,
    r#"{% inline "base" %}<title>{% block title %}{% endblock %}</title><body>{% block main %}{% endblock %}</body>{% endinline %}{% inline "youtube" (id, w=560) %}<iframe width="{{w}}" src="https://youtube.com/embed/{{id}}"></iframe>{% endinline %}{% extends "base" %}{% block title %}{{title}}{% endblock %}{% block main %}<article><h1><a href="{{ get_url "@/about.md" }}">{{title}}</a></h1><time>{{ date_iso | date "%b %d, %Y" }}</time>{{ body | markdown }}{% include "youtube" id="dQw4" %}</article>{% endblock %}"#,
    helpers = [get_url, date, markdown]
);

#[test]
fn zola_host_helpers_compile_and_render() {
    let html = page(&Page {
        title: "Hello".to_string(),
        date_iso: "2026-06-11".to_string(),
        body: "Welcome.".to_string(),
    });
    assert_eq!(
        html,
        "<title>Hello</title><body>\
         <article>\
         <h1><a href=\"/about/\">Hello</a></h1>\
         <time>Jun 11, 2026</time>\
         <p>Welcome.</p>\
         <iframe width=\"560\" src=\"https://youtube.com/embed/dQw4\"></iframe>\
         </article>\
         </body>"
    );
}
