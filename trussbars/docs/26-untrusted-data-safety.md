# Trussbars — Rendering untrusted data safely

> **Status:** **Canonical guide.** **Audience:** anyone rendering attacker-influenced or
> model-generated (LLM/agent) data through a Trussbars template. **Companions:** `docs/24`
> (the N2 northstar this is the value proposition of), `docs/25` (`Value::Safe` — the escape
> hatch named here), `docs/09` (host helpers), `docs/02` (the runtime API). **Proof:** the
> `injection_law` gate (`crates/trussbars-vm/tests/injection_law.rs`) tests every claim below
> adversarially against both dynamic backends on every `cargo test`.

## 1. The threat model — be precise about which "untrusted"

Trussbars is built for exactly one of the two untrusted-input shapes, and **not** the other.

| Shape | Who's hostile | Trussbars? |
| --- | --- | --- |
| **Untrusted data, trusted template** | the *values* (a form field, an API response, **LLM/agent output**) | ✅ **what this guide is about** |
| Untrusted template *authors* | the *template source itself* (multi-tenant user-supplied templates) | ❌ **out of scope** — use a sandboxed engine (Liquid) |

This distinction is the whole story (docs/24). Trussbars sandboxes the **data plane**, not the
template. A malicious *template author* can already name any field, call any allowed helper, and —
because the template is trusted code — that is by design. So Trussbars does **not** solve
"users upload templates." It solves the dual, which is the far more common and far more dangerous
case in 2026: **you wrote the template; the data is the attacker's** (or a language model's).

That intersection — untrusted/model-generated data, rendered, often in a WASM/edge sandbox — has no
good incumbent. An interpreter with *configurable* autoescape (minijinja, Jinja, Twig) makes the
data→code crossing *possible* and then asks you not to misconfigure it; a decade of SSTI CVEs is
the result. Trussbars makes the crossing **unrepresentable**.

## 2. The law — why injection is structurally impossible

> **Names are static; data is dynamic; the two never cross.**

A template head (a helper name, a block keyword, a path segment) is fixed at *parse* time and is
never derived from data. A data value can therefore never:

- **name a helper** — `{{ x }}` with `x = "system"` outputs the string `system`; it does not call
  a `system` helper. Head resolution reads the *template*, never the value.
- **re-enter the parser** — `{{ x }}` with `x = "{{7*7}}"` outputs the literal `{{7*7}}`, not `49`.
  There is no second parse pass over rendered data, so there is no SSTI surface.
- **become markup** — data is **HTML-escaped by default**: `x = "<script>…"` renders
  `&lt;script&gt;…`.

Host helpers are a **compile-time allow-list** the trusted host registers (docs/09); data selects
*arguments*, never the *function*. So even custom helpers cannot be reached by data.

The `injection_law` gate proves all three over a curated corpus (XSS, SSTI canaries, `${jndi}`,
template re-entrancy, path/proto) and a generated fuzz of ~3.6k injection-fragment combinations,
against the interpreter and the VM, on every build.

## 3. The escape hatch — `| safe` / `Value::Safe` bypass escaping *by design*

Be honest: "injection impossible" is true **only until a trusted author opts out**, and they will,
because real pages need some raw HTML. The opt-out is explicit and has exactly two forms:

- **`{{ x | safe }}`** — the `safe` pseudo-filter clears the output node's escape flag (docs/19,
  docs/25). `{{ x | safe }}` with `x = "<b>"` emits `<b>` raw.
- **A host helper / `{% capture %}` / `{% apply %}` returning `Value::Safe`** — a pre-escaped value
  the engine splices verbatim (docs/25).

**Rule: never put untrusted data through `| safe` or a `Safe`-returning helper unless you have
sanitized it in the host first.** `| safe` is for *trusted* HTML you assembled (a host helper that
ran a real HTML sanitizer, a Markdown renderer you trust). The moment untrusted data flows through
`| safe` without host-side sanitization, you have re-opened XSS — the engine cannot help you,
because you *told* it this value is safe.

The `injection_law` gate asserts `{{ x | safe }}` is the **only** path to raw output and that it
differs from the default for any payload with metacharacters — so the hatch is visible, not silent.

## 4. Bound the data *amount* — `Limits` (the DoS half)

The law sandboxes the data *plane*; it does **not** bound the data *amount*. Untrusted data still
controls iteration counts and output size: `{% for x in attacker_array %}` runs once per element,
and a large value interpolated in a loop amplifies. **DoS via untrusted data is real**, so the
dynamic backends take a resource budget — set it whenever the data is attacker-influenced:

```rust
use trussbars_interp::{Template, Limits};
use trussbars_vm::Program;

let limits = Limits { max_steps: Some(1_000_000), max_output: Some(4 << 20) }; // 1M steps, 4 MiB

// interpreter
let html = Template::parse(src)?.with_limits(limits).render(&untrusted_data)?;

// or the bytecode VM (e.g. a hot-reloaded / runtime template)
let html = Program::compile(src)?.with_limits(limits).render(&untrusted_data)?;
```

- `max_steps` charges one per loop iteration / block / partial entry — it bounds **data-driven
  iteration** (a runaway `{% for %}` over a huge array → a located error, not a hung CPU).
- `max_output` caps the rendered bytes — it bounds **amplification** (a small input expanded into a
  huge output).

Both default to **unbounded** (back-compatible), and both backends — including the VM's Env-free
fast loop path — honour them. A breach returns a located `Err`, never a panic or an OOM. The **AOT**
path (`truss!` / `#[derive(Template)]`) is intentionally not budgeted: it renders *trusted*
compile-time templates over *typed* data, which is the trusted-template/trusted-data quadrant.

## 5. The canonical pattern

```rust
use trussbars_interp::{Template, Limits, Value};

// 1. The TEMPLATE is trusted source you author and review. Escaping is on by default; the only
//    `| safe` in it is over host-sanitized HTML, never over raw untrusted data.
const PAGE: &str = r#"
<article>
  <h1>{{ title }}</h1>
  {{ body_html | safe }}   {# host-sanitized markdown — see step 3 #}
  <ul>{% for tag in tags %}<li>{{ tag }}</li>{% endfor %}</ul>
</article>"#;

// 2. The DATA is untrusted (a user, an API, or an LLM). It is plain `Value` — it cannot name a
//    helper, re-enter the parser, or become markup. Bound its amount.
let limits = Limits { max_steps: Some(500_000), max_output: Some(1 << 20) };

// 3. Anything that must be raw is sanitized in the HOST and handed in as already-safe HTML.
let body_html = sanitize_markdown(untrusted_markdown);   // your trusted sanitizer
let data = build_context(untrusted_title, body_html, untrusted_tags);

let html = Template::parse(PAGE)?.with_limits(limits).render(&data)?;
```

The boundary is explicit at every step: untrusted values stay data (escaped, bounded); the one raw
splice (`body_html | safe`) is fed by a *host* sanitizer, not by the engine.

## 6. What this does and does not give you

- ✅ **No injection.** Untrusted data cannot name code, re-enter the parser, or emit markup
  (default escaping). Structurally, not by configuration — proven by the gate.
- ✅ **No resource abuse** (when `Limits` is set). Iteration and output are bounded; a pathological
  value errors instead of hanging.
- ✅ **Portable.** The dynamic backends are `no_std + alloc + forbid(unsafe)`, so this holds in a
  WASM component or on a microcontroller, with no interpreter to initialize.
- ⚠️ **`| safe` is your responsibility.** The engine trusts what the template marks safe. Sanitize
  in the host before `| safe`.
- ❌ **Not for untrusted template authors.** If the *template* is attacker-supplied, this is the
  wrong tool — the law protects the data plane, not the template.
