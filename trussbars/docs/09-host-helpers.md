# Trussbars — The Host-Helper Convention (F3 design)

> **Status:** Design (a v2 feature) · **Audience:** the v2 proc-macro author.
> Closes gap **F3** — the #1 finding from both dogfoods: there is no way for a host
> to provide `date` / `markdown` / `pluralize` / i18n, so they had to be precomputed
> in Rust (see `examples/*/README.md`).

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

## 3. Design: host helpers are free functions resolved by name

**An unknown application head is a host-helper call**, emitted as a path-qualified
free function:

```
{{ date publishedAt "%Y-%m-%d" }}      →   helpers::date(&ctx.publishedAt, "%Y-%m-%d")
{{ body | markdown }}                  →   helpers::markdown(&ctx.body)
```

The host writes ordinary, typed Rust:

```rust
mod helpers {
    pub fn date(ts: &i64, fmt: &str) -> String { /* host's choice of date lib */ }
    pub fn markdown(src: &impl trussbars_core::ToText) -> trussbars_core::Safe {
        trussbars_core::Safe(/* host's markdown render */)
    }
}
```

- **Subject + args.** The piped/first argument is the subject (`&T`), the rest are
  the literal/expression args — matching how the built-in value helpers already
  emit (`trussbars_std::truncate(&x, 5)`).
- **Return type.** `String` (escaped on output like any value) or
  [`Safe`](../crates/trussbars-core/src/text.rs) (markup, emitted raw — e.g.
  `markdown`). The author's `{{ }}` vs `{{{ }}}` still controls escaping of a
  `String`; a `Safe` return is the *typed* way to opt a helper's output out of
  escaping (no `{{{ }}}` needed, and it can't be forgotten).
- **Errors are rustc's.** Wrong arg type / wrong arity → a normal Rust type error at
  the call site (steered to the template span by the `docs/07` machinery). Unknown
  helper → "no function `date` in `helpers`", with the breadcrumb.

## 4. How the macro learns the helper module

| Option | Form | Notes |
| --- | --- | --- |
| **A — convention (recommended)** | a `helpers` module in scope; any unknown head → `helpers::<name>` | zero ceremony; the host just defines `mod helpers`. The macro treats unknown heads as host calls. |
| **B — explicit path** | `truss!(helpers = my_crate::tpl_helpers, "…")` / `#[template(helpers = …)]` | disambiguates when helpers live elsewhere; falls back to A's default. |
| **C — a `Helpers` trait** | host impls a trait, passed beside `ctx` | most structured, but adds a dispatch object and a second parameter — heavier than the niche needs. |

Recommend **A with B as the override**: unknown head → `helpers::<name>(…)`, where
`helpers` defaults to a module named `helpers` in scope and can be redirected with a
`helpers = <path>` argument. No registry, no trait object — just name resolution,
which keeps "names are static" literally true (the name resolves at compile time).

## 5. Relationship to the reference engine (and conformance)

The interpreter's helper pack (`t`/`number`/`date`/`relative`/`selectPlural`) is the
i18n **`Translator` seam** — a documented, *non-byte-identical* host-locale boundary
(`runtime-api §9`, `trussbars-std` deferred note). Trussbars host helpers are the
typed analog: **byte-identity with the reference is the host's responsibility** (their
`date` must match the reference's `date` if they want parity). So host helpers sit
**outside** the conformance harness's byte gate — the oracle uses its helpers, the
typed host uses theirs; the harness can't compare them. Document this clearly: the
corpus proves the *language*, not the host's helper semantics.

A future option: ship a *reference-faithful* `trussbars-i18n` crate (a host-helper
module mirroring the interpreter's i18n pack) so a host that wants parity links it
instead of writing its own — but that's a separate deliverable, not the convention.

## 6. v1 stopgap (today)

Until v2, the dogfoods' approach stands: **precompute in Rust** (format dates,
categorise, render markdown into `Safe`/`String` fields on the context) and let the
template render the precomputed typed fields. The `examples/changelog` `parse_commit`
pile *is* the requirements list this convention satisfies.

## 7. Open questions (resolve when building it)

- **Unknown-head policy.** With convention A, *every* unknown head becomes a
  host-call — so a genuine typo (`{{daet x}}`) surfaces as "no function `daet` in
  `helpers`" rather than "unknown helper". Acceptable (the breadcrumb points at the
  template), but consider a `#[trussbars_helper]` attribute registry if a closed set
  is preferred (turns typos back into "unknown helper" at macro time).
- **Block host-helpers** (`{{#myblock}}…{{/myblock}}`). Out of scope for the first
  cut — value helpers only. Block helpers would need a body-as-closure convention.
- **Arg coercion.** The built-ins coerce args via `stringify`; host helpers take
  native typed args. Decide whether to auto-`&`-borrow the subject (yes, matching the
  built-in emit) and how string-literal args bind (`&str`).
