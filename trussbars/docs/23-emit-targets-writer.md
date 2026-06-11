# Trussbars — Emitter targets `fmt::Write` (enabler for no-alloc `render_into`)

> **Status:** **Accepted** — ready to implement. **Decisions:** (1) **uniform `fmt::Result`** —
> the emitter is writer-generic all the way down, *including* block-helper body closures
> (option B); (2) SizeHint **dropped** on the generic-writer path (kept only for
> `render()`/`truss!`'s `String`); (3) `truss!` keeps a **`String`-only public** surface (a
> private `name_into` wraps the writer primitive). **Consequence of (1) — a docs/09 surface
> change:** a host *block* helper's body closure becomes `impl Fn() -> Result<String,
> core::fmt::Error>` and the helper propagates it (`… -> Result<T, core::fmt::Error>`); existing
> `Fn() -> String` block helpers must be updated (the `frame`/`repeat` tests + the docs/09
> examples). Value helpers (`Fn(args) -> T`) are unaffected. This is a sizable, *atomic*
> refactor (core output layer + every emitted write + the host-block-helper convention +
> conformance re-gate) — it lands as one focused change, not incrementally (the crates won't
> compile mid-way, since `esc`/`ToText` returning `fmt::Result` breaks every call site at once).
> **Audience:** `trussbars-core` (the output layer), `trussbars-template` (the emitter),
> `trussbars-macros` + `trussbars-derive` (the public shapes). **Why:** #5's
> `#[derive(Template)]` wants a genuinely allocation-free `render_into(&mut impl fmt::Write)`
> (docs/22). The emitter today targets a concrete `String`; this is the refactor that lets it
> target an arbitrary writer. **Companion:** `docs/22` (the derive that consumes this),
> `docs/05` (the SizeHint / safe-ceiling perf record), `docs/02` (runtime API).

## 1. Today

The output layer is `String`-concrete:

- `esc<T: ToText>(v: &T, out: &mut String)`, `escape_html(s, out: &mut String)`, and the
  `ToText` trait (`write_text(&self, out: &mut String)`, `write_escaped(…)`) all take
  `&mut String` and call the **inherent, infallible** `String::push_str`.
- The emitter (`emit.rs`) generates `pub fn name(ctx: &T) -> String { let mut out =
  String::with_capacity(SizeHint…); out.push_str("lit"); esc(&x, &mut out); … out }`.

So the only render target is an owned `String`. `render_into` can't be zero-alloc without a
writer-generic path.

## 2. The change

Make the output layer generic over `core::fmt::Write` (available in `no_std`); `String`
already implements it, so existing String callers keep working.

- **Core (`text.rs`):** `ToText::write_text<W: fmt::Write + ?Sized>(&self, out: &mut W) ->
  fmt::Result` (and `write_escaped`); `esc`/`escape_html` likewise generic + `-> fmt::Result`.
  Every impl's `out.push_str(x)` becomes `out.write_str(x)?`; number formatting writes the
  `itoa`/`dragonbox_ecma` buffer via `write_str`. (`ToText` becomes non-object-safe — it is
  only ever a bound, never `dyn`, so that is fine.)
- **Emitter:** the generated primitive becomes
  `fn name_into<W: fmt::Write + ?Sized>(ctx: &T, out: &mut W) -> fmt::Result { … out.write_str("lit")?; esc(&x, out)?; … Ok(()) }`
  — every emitted `push_str` → `write_str(…)?`, every `esc(…)` → `esc(…)?`, body returns
  `fmt::Result`.
- **Public `String` shape stays (non-breaking).** `truss!` still emits
  `pub fn name(ctx: &T) -> String`, now a thin wrapper: pre-size a `String` with the SizeHint,
  call `name_into(ctx, &mut s)` (infallible for `String`), return `s`. **SizeHint stays only on
  this String path** — a generic `W` has no capacity to pre-size, so `render_into(W)` simply
  doesn't use it (the documented trade: zero-alloc, but no adaptive pre-size).

**Output is byte-identical** (same chars, same order, into a different sink), so the v2
conformance gate must stay **87/87** — but it is a hard re-gate requirement, and the emitted
*code shape* changes, so emit unit tests that assert code substrings (`out.push_str(…)`) must
be updated to the `write_str`/`?` shape. (Expression substrings — `truthy_in::<…>`, `NumLit(…)`,
`(in partial '…')` — are unaffected.)

**Surface-agnostic.** This refactor changes the *output target*, not the lexer or surface. It is
orthogonal to the proposed `{% %}` statement-tags direction (`docs/19`), which is a lexer/parser
re-delimiting that leaves the emitter untouched (`docs/19 §3`). The two can land in either order
without interacting.

## 3. The wrinkle that needs a decision — intermediate `String` buffers

Two constructs build a **nested buffer**, then hand it to `ToText`, rather than writing
straight to `out`:

- **Block helpers** (docs/09): `name(args…, || -> String { let mut out = String::new(); <body>
  out })` — the body renders into a fresh `String` the closure returns.
- **`{{#partial}}` / `{{yield}}`** (docs/20): the block body renders into a `yield_buf:
  String` spliced at `{{yield}}`.
- **`{% capture %}`** (docs/18, *proposed*): renders its body into a fresh `String`, bound as a
  `safe` value — the same buffer class. When capture is built it **inherits the decision below**:
  its body emit propagates `fmt::Result` like every other body, and the buffer is a `String`
  (docs/05's "one intentional buffer"), so this ADR's rule already covers it — no separate
  decision needed.

If *all* writes become `write_str(…)?`-returning, these inner closures/buffers — which return
`String`, not `fmt::Result` — don't compose cleanly. Options:

- **(A) Inner buffers stay `String`; only the top-level body is writer-generic.** The body emit
  writes to `out: &mut W`; a block-helper closure keeps building a `String` (writes there are
  infallible — use the `String` sink directly, no `?`). Since `String: fmt::Write`, the same
  emit code works against both `W` (top) and `String` (closures) — *if* the writes are written
  to never need `?` on the `String` path. Cleanest: emit `write!`/`write_str(...).expect("String
  write is infallible")` is ugly; instead keep a tiny `String`-targeting helper for the closure
  bodies. **Some duplication, but contained.** *(Recommended — preserves the no-alloc top-level
  path without making closures fallible.)*
- **(B) Everything returns `fmt::Result`, closures included.** Block-helper closures become
  `|| -> Result<String, fmt::Error>` (or write into a passed sink). Uniform, but it complicates
  the host-helper signature (docs/09) — a host block helper takes `impl Fn() -> String` today;
  making it `Fn() -> Result<…>` is a surface change to the helper convention.
- **(C) Defer true no-alloc; ship `render_into` via `render()`** (the option declined earlier):
  re-examine only if (A) proves too invasive.

The recommendation is **(A)**: the top-level `render_into` is genuinely zero-alloc, while the
*already-buffering* constructs (block helpers, yield) keep their `String` intermediates — they
allocate a small buffer by their very nature (docs/05 names the yield buffer "the one
intentional intermediate buffer"), so not making them writer-generic loses nothing.

## 4. Public shapes after the refactor

- `truss!` — **unchanged public surface**: `pub fn name(ctx: &T) -> String` (SizeHint-sized,
  wraps the private `name_into`). No new public symbol unless we choose to also expose
  `name_into` (decision §5.3).
- `#[derive(Template)]` (docs/22) — `impl Template`:
  `fn render_into<W: fmt::Write + ?Sized>(&self, out: &mut W) -> fmt::Result` (the primitive,
  zero-alloc) and `fn render(&self) -> String` (SizeHint-sized wrapper). Plus the generated
  `Display` writing through `render_into`.

## 5. Decisions (resolved)

1. **Intermediate-buffer strategy: (B) uniform `fmt::Result`** — writer-generic all the way
   down, including block-helper body closures. Consequence: the docs/09 host-*block*-helper
   convention changes — the body closure is `impl Fn() -> Result<String, core::fmt::Error>` and
   the helper propagates it (`fn frame(body: impl Fn() -> Result<String, fmt::Error>) ->
   Result<Safe, fmt::Error>`); the emitted call sites add `?`. Value helpers are unaffected.
2. **SizeHint dropped** on the generic-writer path; kept only for `render()` / `truss!`'s
   `String` wrapper (which pre-sizes a `String` and calls the infallible writer primitive).
3. **`truss!` stays `String`-only public** — a private `name_into` wraps the writer primitive;
   no new public macro surface. `render_into` is exposed only by `#[derive(Template)]`.

**Scope note (implement atomically):** changing `esc`/`ToText` to return `fmt::Result` breaks
every call site at once, so this is one focused, non-incremental change — core output layer +
the ~8 output-write codegen patterns in `emit.rs` (the control-flow *scaffolding* strings —
`if`/`for`/`match` — are untouched; they emit no output) + the `name_into`/`String`-wrapper
split + the host-block-helper convention + every existing block helper (`frame`/`repeat` tests,
docs/09 examples) + a v2 conformance re-gate.

## 6. Test / gate plan

- v2 conformance re-gate **87/87, 0 drift** (output identical; the contract for this refactor).
- Update emit unit tests that assert `push_str`-shape codegen → `write_str`/`?` shape.
- `trussbars-core` tests for the now-generic `esc`/`ToText` over a non-`String` `fmt::Write`
  sink (e.g. a counting writer) to prove the generic path.
- Then docs/22's derive tests exercise `render_into` into a `String` *and* a bare `fmt::Write`.
