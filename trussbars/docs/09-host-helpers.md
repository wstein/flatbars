# Trussbars — The Host-Helper Convention (F3 design)

> **Status:** Implemented (v2) · **Audience:** the v2 proc-macro author.
> Closes gap **F3** — the #1 finding from both dogfoods: there is no way for a host
> to provide `date` / `markdown` / `pluralize` / i18n, so they had to be precomputed
> in Rust (see `examples/*/README.md`).
>
> Shipped as the **closed allow-list** (§7's alternative, not the open "any unknown
> head" convention): a host helper is callable only when its name is declared, via
> `truss!(…, helpers = [date, markdown])` or the `#[truss_helpers(date, markdown)]`
> module attribute. An undeclared head stays a located, macro-time **`unknown
> helper`** error (a typo never silently becomes a host call).

## 1. The constraint that makes this safe

Trussbars' governing rule — **"names are static, data is dynamic, the two never
cross"** — applies cleanly here. A host helper's **name is written in the template**
(`{{date x "%Y"}}`); only its **implementation** is host-provided. **No data chooses
which helper runs.** So host helpers are *not* the SSTI hazard that computed
partials/`apply` are (which stay rejected, freeze §3) — they're just typed function
calls whose name the author picked.

That is the whole reason this is admissible: a host helper is a static call site.

## 2. Why v1 can't, v2 can

The v1 PureScript emitter is **type-blind and host-blind**: it sees `date` as an
unknown head and returns `unsupported: helper 'date'` (it cannot know the host
defines one). So host helpers are a **v2** feature — the proc-macro can be told the
host-helper set (or assume any unknown head is one) and emit a typed call.

## 3. Design: declared host helpers are free functions called by name

**A declared head is a host-helper call**, emitted as a plain free-function call
whose arguments are passed uniformly by reference:

```
{{ date publishedAt "%Y-%m-%d" }}      →   date(&(ctx.publishedAt), &("%Y-%m-%d"))
{{ body | markdown }}                  →   markdown(&(ctx.body))
```

The host writes ordinary, typed Rust functions and brings them into the template
module's scope (a `use`, or a `helpers` module — organisation is the host's choice;
the call itself is unqualified):

```rust
pub fn date(ts: &i64, fmt: &str) -> String { /* host's choice of date lib */ }
pub fn markdown(src: &str) -> trussbars_core::Safe {
    trussbars_core::Safe(/* host's markdown render */)
}
```

- **Subject + args, all by reference.** Every argument is emitted as `&(expr)` — the
  piped/first argument (the subject) and the rest alike. A string- or number-literal
  argument's `&&T` deref-coerces to the host's `&T`, so a signature is plain (`fmt:
  &str`, not `&&str`). This is the uniform analog of how the built-in string pack
  emits (`trussbars_std::uppercase(&x)`).
- **Return type.** `String` (escaped on output like any value) or
  [`Safe`](../crates/trussbars-core/src/text.rs) (markup, emitted raw — e.g.
  `markdown`). The author's `{{ }}` vs `{{{ }}}` still controls escaping of a
  `String`; a `Safe` return is the *typed* way to opt a helper's output out of
  escaping (no `{{{ }}}` needed, and it can't be forgotten).
- **Two error tiers.** An **undeclared** head is a Trussbars-owned, located *macro-time*
  error (`unknown helper 'daet' (declare it with truss_helpers …)`). A declared head
  whose host fn is missing or mistyped is **rustc's** (wrong arg type / arity / "cannot
  find function `date`"), steered to the template span by the `docs/07` machinery.

### 3.1 Block helpers (`{{#name args…}}body{{/name}}`) — shipped (AOT + VM)

A **block** host-helper receives its body as a closure, so it can wrap, suppress, or
repeat the inner template instead of just transforming a value:

```
{{#frame}}hi {{name}}{{/frame}}     →   frame(|| -> String { let mut out = …; out })
{{#repeat 3}}{{name}}{{/repeat}}    →   repeat(&(3f64), || -> String { … })
```

The convention extends the value-helper one with a trailing body closure:

```rust
fn frame(body: impl Fn() -> String) -> trussbars_core::Safe {
    trussbars_core::Safe(format!("[{}]", body()))   // wrap the rendered body once
}
fn repeat(n: &f64, body: impl Fn() -> String) -> String {
    (0..*n as usize).map(|_| body()).collect()       // drive the body N times
}
truss!(framed, Greeting, "{{#frame}}hi {{name}}{{/frame}}", helpers = [frame]);
```

- **Args then body.** The positional args (after the head) are emitted as `&(expr)`
  exactly as for value helpers; the body closure is the **last** parameter, typed
  `impl Fn() -> String`. The closure renders the inner nodes **in the enclosing scope**
  (`{{name}}` still resolves against the same context), so the helper controls *whether*
  and *how often* the body runs — power a pre-rendered string couldn't have.
- **Same allow-list, same boundary.** A block head is a host call **only** if declared
  in `helpers`/`#[truss_helpers]`; an undeclared `{{#x}}…{{/x}}` is the same located
  `unknown helper` macro-time error. The parser is meaning-free — any non-built-in block
  head parses to a `HelperBlock` node and is resolved at emit time (§1's static-name
  guarantee is preserved).
- **Output is markup → written raw.** Unlike a value helper (`String` escaped, `Safe`
  raw), a block helper's return is emitted **raw** on both backends — the body's
  interpolations were already escaped when the closure rendered them, so escaping the
  helper's return would double-escape the body. `String` and `Safe` both write through.
- **No `{{else}}` yet.** A block helper with an `{{else}}` arm is a located, forward-looking
  parse error (`block helper \`x\`: {{else}} is not yet supported`), not a silent drop. The
  inverse-arm convention is **frozen below but unbuilt** — gated on a real consumer.
- **Both backends.** AOT emits `name(args…, || -> String { <body> })`; the VM mirrors it
  via `Helpers::register_block(name, |args: &[Value], body: &dyn Fn() -> Result<String,
  String>| …)`, where `body()` renders the inner nodes in the enclosing scope. Rejected
  in AOT-compat (the proxy registers no helpers), so the AOT≡VM parity holds.

#### Planned: the `{{else}}` inverse arm (frozen convention, not yet built)

The spelling and the helper convention are **frozen here so the implementation is a
transcription, not a redesign** (the project's "decide the surface in the doc before the
PR" rule). Built-in blocks already model an inverse arm — `Each.otherwise`,
`Cond.otherwise`, `With.otherwise` — so `HelperBlock` simply gains `otherwise:
Option<Vec<Node>>` (the `None`/`Some(vec![])` distinction preserves *"`{{else}}` written but
empty"* vs *"no `{{else}}`"*).

- **Surface.** `{{#name args}}main{{else}}inverse{{/name}}` — the existing name-agnostic
  `{{else}}` separator (the same one `if`/`each`/`with` split on); no new syntax.
- **Convention — a *uniform arm-selector*, not a second closure.** The body closure is
  **arm-parameterized**, and the engine **always** passes it (the `Else` arm renders the
  `{{else}}` body, or the empty string when the template wrote none):

  ```rust
  pub enum Arm { Main, Else }
  // AOT:  fn name(args…, body: impl Fn(Arm) -> String) -> R     (R: String | Safe, raw)
  // VM:   helpers.register_block_arms(name,
  //           |args: &[Value], body: &dyn Fn(Arm) -> Result<String, String>| …)
  fn frame(body: impl Fn(Arm) -> String) -> Safe { Safe(format!("[{}]", body(Arm::Main))) }
  ```

  This is the **only** shape that lets *one* helper be called with **and** without
  `{{else}}` and keeps AOT≡VM dispatch identical. Rejected alternatives (decided in the
  team debate): a *dual-shape* emit (else-less `Fn()->String` vs else-ful two-closure) is
  self-defeating — an else-capable helper would then *require* `{{else}}` at every call
  site, because the engine picks the emit shape from the template alone and can't know the
  helper's arity; and a Handlebars-style `options` object re-imports the dynamic-runtime
  complexity the typed backend exists to avoid.
- **Breaking, deliberately.** It replaces the shipped `Fn() -> String` with `Fn(Arm) ->
  String`. Acceptable: the API is young, the project keeps no back-compat layers, and the
  break buys uniformity + "can't-misuse". The common (no-else) helper pays only
  `body(Arm::Main)` over `body()`.
- **Still raw, still allow-listed, still rejected in AOT-compat** — unchanged from above.
- **When built (not now):** land it *with* a real example helper that uses `{{else}}`
  (e.g. a `take n` / `paginate`), rendered through AOT **and** the VM and byte-compared,
  added to the `--interp`/`--vm-compat` conformance axes — no untested convention ships.
- **Not** this: *named, multi-arm* blocks (`{{#case}}…{{when …}}…{{else}}`) are a
  separate feature with their own decision doc — see [`docs/12`](12-case-multiarm-blocks.md).
  `Arm` is forward-compatible (it can grow variants without changing the closure shape),
  but `{{when}}` arms are out of scope for the binary inverse arm.

## 4. How the macro learns the allow-list (shipped)

The set of callable host helpers is **declared, at compile time** — only declared
names resolve to a host call; everything else stays a built-in or an `unknown helper`
error. Two equivalent surfaces:

| Form | Where | Notes |
| --- | --- | --- |
| **Per-call clause** | `truss!(render_post, PostCtx, path = "…", helpers = [date, markdown])` | the literal allow-list, on one template. |
| **Module attribute** | `#[truss_helpers(date, markdown)] mod templates { truss!(…); … }` | declares it once; the attribute rewrites each inner `truss!` to carry the same `helpers = […]`. |

Both are pure compile-time token wiring — no registry, no trait object, no runtime
dispatch — which keeps "names are static" literally true (the name resolves to a
static Rust path at compile time). This is the *closed-set* choice over the original
"any unknown head is a host call" convention, so a typo is caught at macro time (§7).

## 5. Relationship to the reference engine (and conformance)

The interpreter's helper pack (`t`/`number`/`date`/`relative`/`selectPlural`) is the
i18n **`Translator` seam** — a documented, *non-byte-identical* host-locale boundary
(`runtime-api §9`, `trussbars-std` deferred note). Trussbars host helpers are the
typed analog: **byte-identity with the reference is the host's responsibility** (their
`date` must match the reference's `date` if they want parity). So host helpers sit
**outside** the conformance harness's byte gate — the oracle uses its helpers, the
typed host uses theirs; the harness can't compare them. Document this clearly: the
corpus proves the *language*, not the host's helper semantics.

**Shipped:** the `trussbars-i18n` crate — host-helper implementations of the
interpreter's i18n names (`t`/`number`/`date`/`selectPlural`/`relative`), declared
with `#[truss_helpers(date, number, …)]`. `date`/`number` are real, dependency-free
formatters; **`selectPlural` is CLDR-accurate** (table-driven, per-language cardinal
categories — en/de/fr/ru/pl/cs/ar/ja… ); `t` is an explicit **fallback** that returns
the key (a zero-dependency crate has no catalog). Byte-identity to a particular locale
runtime (JS `Intl`, ICU) stays the host's choice, per the boundary above.

**For real message translation**, a host declares its *own* `t` over a catalog — see
the worked recipe in **`examples/i18n-fluent/`**: Project Fluent via `i18n-embed`, a
process-wide `FluentLanguageLoader` with runtime language negotiation (en/de/pl), wired
into a `#[truss_helpers(t)]` `t`. It also documents the one wrinkle — the template's
key arrives as a runtime `&str`, so `t` uses the loader's runtime `get` rather than the
compile-time-checked `fl!` (which needs a *literal* id). Recovering that id check at
the Trussbars **macro** layer (validating `{{t "id"}}` literals against the catalog at
expansion time) is a tracked future extension — it is the only way to get Fluent-style
compile-time checking inside the static-name model.

## 6. v1 stopgap (today)

Until v2, the dogfoods' approach stands: **precompute in Rust** (format dates,
categorise, render markdown into `Safe`/`String` fields on the context) and let the
template render the precomputed typed fields. The `examples/changelog` `parse_commit`
pile *is* the requirements list this convention satisfies.

## 7. Resolved decisions

- **Unknown-head policy — closed set.** A head is a host call **only** if declared in
  the allow-list (§4); an undeclared head is a located, macro-time `unknown helper`
  error. So a typo (`{{daet x}}`) is caught before rustc, the closed-set behaviour the
  original §7 open question preferred over "any unknown head becomes a call".
- **Arg coercion — uniform `&(expr)`.** Every argument (subject and the rest) is
  auto-borrowed; a literal's `&&T` deref-coerces to the host's `&T`, so signatures are
  plain references. Matches the built-in string-pack emit.

> Resolved: **block host-helpers** (`{{#name}}…{{/name}}`) shipped on **both** backends —
> AOT (`name(args…, || -> String {…})`) and the VM (`Helpers::register_block`, body as a
> `&dyn Fn() -> Result<String, String>`). The body-as-closure convention is §3.1.

### Still open (not needed yet)

- **Block-helper `{{else}}`** — the inverse arm (`{{#x}}…{{else}}…{{/x}}`) is rejected with
  a forward-looking located error; the convention is now **frozen** (the uniform
  arm-selector, §3.1 "Planned"), with implementation gated on a real consumer. *Multi-arm*
  `{{#case}}…{{when …}}…{{else}}` is a separate feature — [`docs/12`](12-case-multiarm-blocks.md).
- **Macro-layer catalog checking** (§5) — validating `{{t "id"}}` literals against a
  host catalog at `truss!` expansion time, to recover Fluent's compile-time id check
  inside the static-name model.

> Resolved: the i18n pack (`trussbars-i18n`) shipped (§5), and the real-Fluent path is
> the worked `examples/i18n-fluent` recipe — so a separate turnkey Fluent crate is *not*
> tracked; a host that wants Fluent copies the recipe and declares its own `t`.
