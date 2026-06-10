# Trussbars — `{{#capture name}}…{{/capture}}` (render-body-into-variable)

> **Status:** **Proposed** — a Liquid-borrowed *surface* construct, adapted to Trussbars's
> typed, auto-escaping model. `{{#capture name}}…{{/capture}}` renders its body once into a
> **pre-escaped safe string** and binds it forward (the `{{assign}}` scope, `docs/17`) so the
> result is a first-class value: printable with `{{name}}`, pipeable into filters, passable to
> helpers/partials. Reference (to be added): an engine handle in the **nonEmpty-family surface
> (RawBars/MaxBars)** that renders the body and installs the result as a nullary `safe` value.
> Trussbars lowers it to **render-into-a-`String`, bound to a `let name: Safe`**. **Audience:**
> whoever extends surface binding/output. Companions: `docs/17` (`{{assign}}` — the scope this
> shares; `capture` is *"assign whose RHS is a rendered body"*), `docs/01`/`docs/06` (subset +
> freeze, amended §5), `docs/09` (host helpers — a frequent consumer of captured strings),
> `docs/04` (conformance), `docs/05` (the perf note: capture is the one intentional buffer).
>
> **Spelling note (superseded by `docs/19`).** In RawBars/MaxBars/Trussbars this is spelled
> **`{% capture name %}…{% endcapture %}`** under the Django-style `{% %}` statement-tag surface
> (`docs/19`); the `{{#capture …}}` spelling below predates that ADR. The **semantics are
> unchanged** — only the delimiters move.
>
> **Naming.** The keyword is **`capture`** (Liquid/Ruby), spelled as a block
> (`{{#capture name}}…{{/capture}}`) because it *has* a body — unlike `{{assign}}`, which has
> an expression RHS. `capture` is to `assign` what a rendered block is to an expression.

## 1. Context

Two of Trussbars's most-wanted ergonomics need a *rendered fragment as a value*:

1. **Build once, use many.** Assemble a snippet of markup/text with full template power
   (conditionals, loops, partials) and reuse it in several places without re-rendering.
2. **Render → transform.** Produce text, then run it through a filter or a host helper —
   `{{#capture body}}…{{/capture}}{{ body | truncate 280 }}`, or feed a captured markdown
   string to a `markdown` host helper (docs/09).

`{{assign}}` (docs/17) binds an *expression*; `{{#inline}}` (docs/06 §1) defines a *named,
re-invokable template fragment* (a partial), not a *value*. Neither yields what Liquid's
`{% capture %}` does: **a string value that is the rendered body**, usable everywhere a value
is. The governing question is the **escaping contract** (the body is already rendered output —
re-escaping it on `{{name}}` would double-escape) and the **cost** (capture is the one place
Trussbars must allocate an intermediate buffer).

```handlebars
{{#capture byline}}
  {{author.name}}{{#if author.title}} · {{author.title}}{{/if}}
{{/capture}}

<header>{{byline}}</header>
<footer>{{byline}}</footer>          {{!-- reused, rendered once --}}
<meta name="author" content="{{ byline | trim }}">   {{!-- and transformable --}}
```

## 2. Decision

**`{{#capture name}}…{{/capture}}` renders its body exactly once into a pre-escaped `safe`
string and binds `name` with `{{assign}}` scope** (forward to the enclosing block's close,
`docs/17 §2`). The captured value carries the `safe` marker, so `{{name}}` emits it
**verbatim** (the body's own `{{ }}` already escaped during capture — no double-escaping).

Frozen surface:

- `{{#capture NAME}}…body…{{/capture}}` — a block with a body. `NAME` follows the `{{assign}}`
  name grammar and reservation rules (docs/17 §2: no shadowing reserved scope names or built-in
  block heads — located error).
- **The body is an ordinary template fragment** — any construct is legal inside it (output,
  `{{#if}}`/`{{#each}}`/`{{#with}}`/`{{#let}}`/`{{assign}}`, `{{> partial}}`, nested
  `{{#capture}}`). It renders in the surrounding context (it does **not** re-root).
- **The result is `safe`** (pre-escaped). `{{NAME}}` emits it without re-escaping; `{{{NAME}}}`
  is identical (already raw). Piping is by value: `{{ NAME | trim }}` operates on the rendered
  string.
- **Scope is forward, to the enclosing block's close** — the binding *outlives the capture
  block* (the body delimits what is rendered, not how long `NAME` lives). This is the Liquid
  semantics and matches `{{assign}}`; it is **stricter than Liquid only** in not leaking past
  the enclosing block (docs/17 §5.2).
- **Rendered once, eagerly.** The body is rendered at the `{{#capture}}` site regardless of
  whether `NAME` is later used — capture is not lazy. (Unused captures are a lint, not an
  error; §5.3.)

## 3. The lowering (concrete)

The parser builds a `Capture { name, body }` node (a sibling of `Let`; its `body` is a normal
node list). The AOT emitter renders the body into a fresh `String` and binds it as a `safe`
value with the forward `{{assign}}` scope:

```handlebars
{{#capture byline}}{{author.name}}{{#if author.title}} · {{author.title}}{{/if}}{{/capture}}
<header>{{byline}}</header>
<footer>{{byline}}</footer>
```

```rust
// {{#capture byline}} … {{/capture}}  →  render the body into a buffer, bind it `safe`
let byline: trussbars_std::Safe = {
    let mut __cap = String::new();
    __cap.push_str(&trussbars_std::escape_html(&ctx.author.name));
    if trussbars_std::truthy(&ctx.author.title) {
        __cap.push_str(" · ");
        __cap.push_str(&trussbars_std::escape_html(&ctx.author.title));
    }
    trussbars_std::Safe(__cap)
};                                   // ← `byline` lives forward, like an `assign`
out.push_str("<header>");
out.push_str(byline.as_str());       // safe → emitted verbatim, NOT re-escaped
out.push_str("</header>\n<footer>");
out.push_str(byline.as_str());
out.push_str("</footer>\n");
```

The body emits with the *same* per-output escaping it would have at top level (`escape_html`
for `{{ }}`, passthrough for `{{{ }}}`/`safe`/partials), so the captured string is "rendered
output, frozen." Wrapping it in `Safe` is what makes the later `{{byline}}` a passthrough —
the type *is* the escaping contract, checked by the compiler, not a runtime flag.

In the PureScript oracle the construct renders its body with the active engine
(`runResolved`-style sub-render in the current frame) and installs `name` as a nullary
operation returning `VSafe rendered` in the current frame — so `{{name}}` yields the
already-escaped text and the frame's close discards the binding (the `{{assign}}` scope). The
JS compiler and the VM mirror render-into-buffer-then-bind; all backends are pinned byte-for-
byte by the corpus. Like `{{assign}}`/`{{#let}}`/`{{#case}}`, `capture` is **RawBars/MaxBars
only**; **FullBars** rejects it with a located error (use `{{#inline}}`/`{{#partial}}`), and in
**MinBars** it is an ordinary section.

## 4. Alternatives considered

| # | Alternative | Verdict | Why |
| --- | --- | --- | --- |
| **A1** | **Render body → `Safe` string, bound with `{{assign}}` scope** | **Chosen** | The minimal faithful adaptation: one `Capture` node, a buffer, a `Safe` binding. The `safe` type encodes "already escaped" so the compiler — not a runtime flag — prevents double-escaping, and the forward scope reuses `docs/17`. |
| **A2** | Auto-escape `{{name}}` on output (treat the captured string as untrusted) | **Rejected** | Double-escapes — a captured `<b>x</b>` would print as `&lt;b&gt;x&lt;/b&gt;`. The body already chose its escaping per `{{ }}`/`{{{ }}}`; re-escaping the *result* is wrong. `Safe` is the correct type. |
| **A3** | Lazy capture (render only if `NAME` is used) | **Rejected for v1** | Saves the buffer when unused, but the body can read loop/scope state that has moved by the use site — capturing a *closure* over `&ctx` re-introduces lifetimes and breaks the "rendered once, here" mental model. Eager keeps semantics obvious; an unused-capture *lint* (§5.3) recovers most of the benefit. A use-once *inline* optimization is a future codegen nicety, not surface. |
| **A4** | Use `{{#inline "n"}}…{{/inline}}` + `{{> n}}` instead | **Insufficient** | An inline partial is a re-invokable *fragment*, not a *value*: you cannot `{{ (> n) \| truncate 280 }}` or compare/pass its text. Capture's whole point is a first-class string. They coexist (fragment-reuse vs value-capture). |
| **A5** | Do nothing | **The baseline** | Repeat the markup, or precompute the string in a host helper (docs/09). A1 buys in-template render-and-reuse without a host round-trip. |

## 5. Consequences

### 5.1 The one intentional buffer (a documented perf cost)

Trussbars renders straight to the output sink with no intermediate allocations (docs/05, the
safe-Rust ceiling). `{{#capture}}` is the deliberate exception: it allocates a `String` and
renders into it eagerly. The cost is bounded (only where authored) and visible (a `Safe` bind
in the generated code). The size-hint pass (docs/02) should seed `__cap`'s capacity from the
body's static-text length, as it does for the main buffer.

### 5.2 `Safe` is the escaping contract, statically

A captured value is `trussbars_std::Safe`. Emitting it is passthrough; passing it to a host
helper or filter that expects `&str` coerces via `as_str()`. A helper that needs to *escape*
its input still can — but the default `{{name}}` does not, which is the correct "render once"
semantics. This makes the no-double-escape guarantee a *type* property, not a convention.

### 5.3 Eager, with an unused-capture lint

Because capture is eager, a `{{#capture x}}…{{/capture}}` whose `x` is never read still renders
its body (wasted work). v1 keeps eager semantics (A3) but the linter/inspector (docs/10) should
flag an unread capture as a warning — the same located-finding discipline used elsewhere.

### 5.4 The injection boundary is untouched

`NAME` is static; the body is a static template fragment. No data selects a name or a code
path — capture is inside the boundary (docs/06 §3) by construction.

### 5.5 Governance: nonEmpty-family *surface*, oracle-first

A language/surface construct, so it lands in the RawBars/MaxBars oracle first (or together),
giving the corpus an authority before Trussbars conforms byte-for-byte (docs/12 §5.5).

## 6. Status & sequencing

1. **Surface frozen (§2).** Spelling, the `safe` result, the forward `{{assign}}` scope,
   eager rendering, and the reservation rules are fixed here.
2. **Oracle first (§5.5).** `capture` lands in RawBars/MaxBars (body sub-render → `VSafe`
   nullary in the current frame); add `capture-*` cases: reuse, the no-double-escape proof
   (`<b>` survives), pipe-the-result (`| trim`), nested capture, the reserved-name rejection.
3. **Trussbars Rust.** Parser builds `Capture`; the emitter renders the body into a `String`
   and binds `Safe` with `{{assign}}` scope; the VM mirrors it; size-hint seeds `__cap`.
   Corpus on `--v2`/`--vm`/`--vm-compat`; freeze (docs/06 §5) amended to list `capture` IN;
   the unused-capture lint filed against docs/10.
4. **Importer (docs/15).** Map Liquid `{% capture %}` → `{{#capture}}`, noting the escaping
   difference (Liquid's captured string is re-escaped on output by an explicit `escape`
   filter; Trussbars's is `safe` by default) as a located migration finding.

## 7. Summary

- `{{#capture name}}…{{/capture}}` **renders its body once into a pre-escaped `safe` string**
  and binds it forward (the `{{assign}}` scope) — a first-class value: printable, pipeable,
  passable to helpers/partials.
- The result is **`safe`**, so `{{name}}` emits it **verbatim** — no double-escaping. The type
  *is* the escaping contract (§4 A2, §5.2).
- The AOT lowering is **render-into-`String` → `let name: Safe`**; it is the **one intentional
  intermediate buffer** in Trussbars (docs/05), bounded and size-hinted.
- It is **`capture`** (a block, because it has a body) and the rendered-body counterpart to
  `{{assign}}`; distinct from `{{#inline}}`, which yields a re-invokable fragment, not a value.
- **nonEmpty-family surface** (RawBars/MaxBars + Trussbars); FullBars/MinBars reject it.
  Oracle-first, conformance-pinned across all backends, eager with an unused-capture lint.
