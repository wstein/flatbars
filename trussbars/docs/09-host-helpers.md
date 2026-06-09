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

A future option: ship a *reference-faithful* `trussbars-i18n` crate (a host-helper
module mirroring the interpreter's i18n pack) so a host that wants parity links it
instead of writing its own — but that's a separate deliverable, not the convention.

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

### Still open (not needed yet)

- **Block host-helpers** (`{{#myblock}}…{{/myblock}}`) — value helpers only for now;
  a block helper would need a body-as-closure convention.
- **A reference-faithful `trussbars-i18n` crate** (§5) — a separate deliverable.
