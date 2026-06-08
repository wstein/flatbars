# Trussbars v2 — Diagnostic Span-Mapping Spike

> **Status:** Design spike (no code yet — full v2 is deferred until the freeze,
> docs/06, is ratified). **Audience:** the v2 proc-macro author.
>
> The consensus pinned v2's headline value as **diagnostics**, not speed (the
> generated code is already at the safe-Rust ceiling, docs/05). This spike de-risks
> the hard part — mapping a template error back to the template — before committing
> to the rewrite.

## 1. The problem, concretely

Today the emitter is a separate PureScript tool; the host commits the generated
Rust. A field typo in `post.truss` (`{{post.titlee}}`) surfaces as:

```
error[E0609]: no field `titlee` on type `Post`
  --> src/templates.rs:69:36          ← the GENERATED file, not post.truss
help: a field with a similar name exists
```

The user never wrote `src/templates.rs:69`. They wrote `post.truss`. **The error
points at the wrong artifact** — gap F6. The target:

```
error[E0609]: no field `titlee` on type `Post`
  --> templates/post.truss:2:11
  |
2 |   <h1>{{post.titlee}}</h1>
  |              ^^^^^^^
help: a field with a similar name exists: `title`
```

That is the whole v2 DX win. Everything else (deleting the PureScript toolchain,
compile-time codegen) follows from being a proc-macro; this is the part that needs
a plan.

## 2. Error taxonomy — who can even detect it

| Class | Examples | Detected by |
| --- | --- | --- |
| **A — Trussbars-owned** | parse error, unknown helper, wrong arity, unsupported construct, set-delim in a non-MinBars dialect | **Trussbars**, at macro-expansion. It has byte-spans (ADR-023 recovering parser, `NodeError`). |
| **B — type-owned** | unknown field (`titlee`), type mismatch (`i64 > f64`), helper arg type, `{{struct}}` | **rustc**, against the host's types. Trussbars cannot know the struct's fields. |

The two classes need **different mechanisms**. Class A we can make perfect; class B
we can only *steer* rustc's own error to the right span.

## 3. Mechanisms and their stable-Rust limits

### Class A → `compile_error!` (fully stable)

Trussbars detects these itself and owns the byte-span, so emit:

```rust
::core::compile_error!("post.truss:4:12: unknown helper `marqdown` (did you mean a host helper? see docs/06 §4)");
```

with the macro **call-site** span. The message carries precise template
coordinates. This is stable, total, and already within reach — Trussbars' parser
produces exactly these spans. **Class A is solved.**

**The v1 emitter already produces the message half.** In commented mode every
"unsupported …" is prefixed with its `file:line:col` breadcrumb — e.g.
`catalog.truss:2:1: unsupported: helper 'where'` — exactly the string v2 drops into
`compile_error!(…)`. So the class-A diagnostic is *one `compile_error!` wrapper away*
in v2; the located message exists today (`compileMaxRustCommented`). The same
breadcrumb also rides as a `#[doc]` provenance attribute on each render fn.

### Class B → `quote_spanned!` + the span-source problem

rustc reports the error at the `Span` of the tokens we emit. So emit the field
access with a span that points into the template:

```rust
// instead of  quote!(ctx.post.titlee)
quote_spanned!(field_span => ctx.post.titlee)
```

The catch is **where `field_span` comes from**, and it differs by entry form:

| Entry form | Span source | Stable? |
| --- | --- | --- |
| **`truss!("…inline…")`** | `proc_macro::Literal::subspan(range)` into the string literal — exact intra-string spans | **No** — `proc_macro_span` is unstable (nightly). |
| **`#[template(path="post.truss")]`** | the template isn't in the Rust token stream at all | No source tokens exist to span into |

So on **stable Rust, exact intra-template spans are not yet available** for either
form. This is the core constraint the spike surfaces.

### Stable fallbacks (good, not perfect)

1. **Name generated locals after the template path.** Emit `__post__titlee`
   instead of `__c2`, so even when the span is coarse, rustc's message reads
   `no field … ` near an identifier that *names the template path*. Cheap, total,
   big readability win over `__c2`.
2. **A spanned typed assertion per access.** Emit, alongside each access, a
   zero-cost `const _: fn(&Post) = |p| { let _ = &p.titlee; };` whose tokens carry
   the best available span and whose sole job is to make rustc point there. The
   real render code can then use a clean access.
3. **A `// {{…}}` / `// post.truss:4:12` trail** on each emitted statement — turns
   the wrong-file location into a breadcrumb the user can follow even
   pre-span-mapping. **The v1 emitter already does the source-trail half**
   (`compileMaxRustCommented` annotates each statement with the originating surface,
   sliced by the node's span; the `examples/` generated modules use it). That it
   slices cleanly *after* `desugarSurfaceWith` is the key feasibility evidence: the
   spans v2 needs for `quote_spanned!` survive desugaring intact.
4. **`compile_error!` for the subset of class B Trussbars *can* pre-check** — e.g.
   `{{struct}}` (no `ToText`): rather than let rustc complain about a missing trait
   on generated code, Trussbars can emit a `compile_error!` with the template span
   when it sees a bare struct path used in output position, *if* it is given the
   context type's shape. (See §4 open decision on type info.)

## 4. Recommended v2 architecture

1. **Two entry forms**, both supported:
   - `truss!("…")` — inline; best DX, and the path to *exact* spans once
     `proc_macro_span` stabilizes (or under nightly today).
   - `#[derive(Template)] #[template(path="post.truss")]` — Askama-familiar; file
     templates get the §3 fallbacks (named locals + breadcrumbs), not exact spans.
2. **Class A**: always `compile_error!` with `path:line:col` — precise on stable,
   for both forms. Implement first; it's most of the felt pain and it's free.
3. **Class B**: `quote_spanned!` with the best span available
   (`subspan` under nightly/inline; call-site + named locals + breadcrumb on
   stable), plus the named-locals rule (#1) unconditionally — it costs nothing and
   lifts every class-B error out of `__c2` territory.
4. **Gate the diagnostics themselves**: a `trybuild` (`compile_fail`) suite pinning
   the exact error text/location for a corpus of broken templates, so the DX is a
   tested contract, not a hope. This is the single most important new test artifact
   v2 introduces.

## 5. Open decisions (resolve when v2 starts)

- **Stable vs nightly for exact inline spans.** Recommended: **target stable**, ship
  the §3 fallbacks now, and feature-detect `proc_macro_span` to upgrade `truss!`
  to exact spans automatically when it stabilizes. Do **not** make the core require
  nightly.
- **How much type info does the macro get?** A bare proc-macro sees only tokens, not
  the resolved type of `ctx`. To pre-check class-B errors (e.g. `{{struct}}`,
  unknown field) *at macro time* would need the context type's shape — via a
  `#[derive(Trussbars)]`-supplied type descriptor the `truss!` invocation references.
  Decision: start **without** it (let rustc own class B via spans), add a descriptor
  later only if the fallbacks prove insufficient.
- **Inline-first or path-first?** Recommended: build `truss!` first (best spans,
  simplest), add the `path=` derive second for migration familiarity.

## 6. Scope guard

This is a spike. **Full v2 is deferred** until the feature freeze (docs/06) is
ratified, so the proc-macro's desugar surface is built against a settled language —
not a moving one. When it starts, the build order is: class-A `compile_error!`
first (cheap, high relief), then `truss!` with named locals + `quote_spanned!`, then
the `trybuild` diagnostic gate, then the `path=` form.
