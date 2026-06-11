# Trussbars — `#[derive(Template)]` ergonomics (#5)

> **Status:** **Accepted** — decisions ratified 2026-06-10 (§5): **(1)** both `render(&self) -> String`
> *and* `render_into(&mut impl fmt::Write)`; **(2)** **full `truss!` clause parity** (`helpers`/
> `truthiness`/`partials`) in v1; **(3)** infallible trait + `Display`. **Hard prerequisite: `docs/23`**
> (emit→`fmt::Write`) — `render_into` needs it, so build docs/23 first, then this derive on top.
> **Audience:** `trussbars-derive` (the derive), `trussbars-core` (the `Template` trait),
> `trussbars-template` (the reused emitter). **Resolves:** review #5 — the `truss!(name,
> CtxType, "…")` free-function shape repeats `CtxType` at every call and isn't the
> `#[derive(Template)] struct` form Rust users expect (named a v2 goal in spec §8). **Companion:**
> `docs/09` (`helpers`), `docs/16` (`truthiness`), `docs/21` (`partials`), `docs/07` (diagnostics).

## 1. The gap

`truss!(greeting, Greeting, "Hello {{name}}")` emits a **free function** and the caller passes
both a name and the context type. The idiom Rust template users expect (Askama, Sailfish) is a
struct that **owns** its template, with its fields as the context:

```rust
#[derive(Template)]
#[template(path = "hello.truss")]
struct Greeting { name: String }

let s = Greeting { name: "world".into() }.render();   // and `{greeting}` via Display
```

This is the same engine — just a more idiomatic, lower-ceremony surface. The chosen API is the
**`Template` trait + `Display`** (Askama-faithful), so `{}`-formatting and trait-object
composition work.

## 2. Surface

```rust
#[derive(Template)]
#[template(source = "<h1>{{title}}</h1>")]    // inline …
struct Page { title: String }

#[derive(Template)]
#[template(path = "templates/page.truss")]    // … or a file (CARGO_MANIFEST_DIR + include_bytes!)
struct Page2 { title: String }

#[derive(Template)]                            // full truss! clause parity (decision §5.2)
#[template(
    path = "templates/invoice.truss",
    helpers = [money, date],                   // docs/09 — typed host fns
    truthiness = Liquid,                        // docs/16 — selectable policy
    partials = [row, footer],                   // docs/21 — cross-file partials
)]
struct Invoice { /* … */ }
```

- The struct's **fields are the context** — `{{title}}` is `self.title` — so no `CtxType`
  argument: `Self` *is* the type. Exactly one of `source` / `path` is required.
- **Full `truss!` clause parity (v1):** `#[template(…)]` accepts `helpers` / `truthiness` /
  `partials` with identical semantics — the derive forwards them to the same emitter, so the two
  surfaces never diverge.
- The `path` form reads at expansion time (relative to `CARGO_MANIFEST_DIR`, like `truss!`'s
  `path =`) and `include_bytes!`-tracks the file.
- Generates `impl trussbars_core::Template for Page` (with `fn render(&self) -> String`) **and**
  `impl core::fmt::Display for Page` (writing the rendered output), so a `Page` formats with
  `{}` and composes into other templates as a value.
- A class-A error (parse / unknown helper / unsupported) is a located `compile_error!`, exactly
  as for `truss!` — the derive funnels through the same emitter.

## 3. The trait (in `trussbars-core`)

`render_into` is the **primitive** (renders straight into any `fmt::Write` sink — the writer is the
*only* fallibility); `render` is an **infallible** convenience defaulted on top of it (writing into a
`String` cannot fail, so the `fmt::Result` is discarded); `SIZE_HINT` pre-sizes the buffer from the
static-text length (the `docs/02` SizeHint pass).

```rust
pub trait Template {
    /// Pre-allocation hint (static-text length; the docs/02 SizeHint pass). Default 0.
    const SIZE_HINT: usize = 0;

    /// The primitive — render into any sink. The writer is the only fallibility.
    fn render_into<W: core::fmt::Write + ?Sized>(&self, out: &mut W) -> core::fmt::Result;

    /// Convenience — render to an owned `String`. **Infallible** (String-write can't fail).
    fn render(&self) -> String {
        let mut s = String::with_capacity(Self::SIZE_HINT);
        let _ = self.render_into(&mut s);
        s
    }
}
```

The derive generates `SIZE_HINT` + `render_into` per type (`render` is the defaulted method — no
per-type codegen), plus a **zero-alloc `Display`** that writes through `render_into` *directly*:

```rust
impl core::fmt::Display for Page {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.render_into(f)        // straight to the formatter — no intermediate String
    }
}
```

So the §5 choice of `render_into` pays off **twice**: the no-alloc render path *and* a no-alloc
`Display` (the earlier `f.write_str(&self.render())` allocated a throwaway `String`). Note
`render_into` is generic, so it is not `dyn`-safe; `render()`/`Display` keep `Template` usable as a
value, and a `&mut dyn fmt::Write` shim can be added if trait objects are ever needed. The whole path
**depends on the emit→`fmt::Write` refactor (`docs/23`)** — land that first.

## 4. Codegen (reusing the emitter)

`trussbars-derive` already uses `syn`/`quote`. The plan:

1. Parse the `#[template(...)]` attribute (source/path + the tuning clauses chosen in §6) and
   read the `path` file if given.
2. Call `trussbars_template::emit_named("__render", "<SelfType>", src, helpers, mode)` (or
   `emit_with_partials`), where `<SelfType>` is the struct's identifier + its generics — the
   emitter is type-blind, so `{{title}}` becomes `ctx.title`.
3. Emit the impls, nesting the generated function inside `render` so nothing leaks into the
   module:

   ```rust
   impl Template for Page {
       const SIZE_HINT: usize = #static_len;
       fn render_into<W: core::fmt::Write + ?Sized>(&self, out: &mut W) -> core::fmt::Result {
           #emitted_fn               // `fn __render_into<W>(ctx: &Page, out: &mut W) -> fmt::Result { … }`
           __render_into(self, out)
       }
       // `render` is the trait default (render_into into a SIZE_HINT-sized String)
   }
   impl Display for Page { /* fn fmt → self.render_into(f) */ }
   ```

   Step 2 now targets a **`fmt::Write` sink** (`docs/23`), not a returned `String` — that is the
   refactor `render_into` depends on. The emitter prefixes `pub fn`; the derive strips the leading
   `pub` keyword (or we add a private-fn entry point — an implementation detail, not a surface decision).

This adds a `trussbars-derive → trussbars-template` build-dependency (compile-time only;
nothing new at runtime). The emitted body still links `trussbars-core`/`trussbars-std`, exactly
like `truss!`.

**Relationship to `#[derive(Trussbars)]`:** unchanged. `#[derive(Template)]` makes a type
*renderable*; `#[derive(Trussbars)]` makes a type usable as a truthy/sub-context value
(`{% scope sub %}`, `{% if this %}`). A leaf struct rendered at top level needs only `Template`; a
struct also used as a nested context still derives `Trussbars`. (They compose; a struct may
derive both.)

**Conformance:** additive surface, no oracle path — no byte-identity impact. Gated by new
`trussbars-derive` tests (render + `Display` + a `path` case) and a `trybuild` golden for a
located error in a derived template.

**Surface-agnostic & sequencing.** This derive reuses the emitter, so it is independent of the
template *surface*: it works the same whether a `.truss` body uses today's `{{ }}` control flow
or the proposed `{% %}` statement tags (`docs/19`). It does, however, depend on the
emit→`fmt::Write` refactor (`docs/23`) for the zero-alloc `render_into` — build that first, then
this derive on top.

## 5. Decisions (ratified 2026-06-10)

1. **render API — BOTH.** Generate `render_into(&mut impl fmt::Write)` as the **primitive** *and*
   `render(&self) -> String` as the defaulted convenience (§3). The no-alloc path is in from v1, and
   `Display` rides on `render_into` (zero-alloc formatting). **Cost:** depends on the emit→`fmt::Write`
   refactor (`docs/23`) — that lands first.
2. **Attribute scope — FULL `truss!` parity in v1.** `#[template(…)]` accepts `helpers` / `truthiness`
   / `partials` alongside `source`/`path` (§2), forwarded to the same emitter. More attribute-parsing
   and tests up front, but the derive reaches feature-parity with `truss!` immediately.
3. **Trait — infallible, in `trussbars-core`.** `trait Template { const SIZE_HINT; fn render_into<W>(…)
   -> fmt::Result; fn render(&self) -> String { default } }` + the derive emits `Display`. Infallible
   `render` is a Trussbars differentiator (all errors are compile-time) — confirmed over the
   Askama-faithful `Result` shape.

## 6. Test plan (decided — §5)

- `trussbars-derive` render tests: an inline `source` struct and a `path` struct both `.render()`
  to the expected bytes; `format!("{}", page)` (Display) matches `render()`.
- **`render_into` parity (§5.1):** `render_into` into a fresh `String` equals `render()`; the
  `Display` path (which calls `render_into` on a `Formatter`) equals both — proving the primitive,
  the defaulted convenience, and the zero-alloc `Display` agree.
- A nested case: a `#[derive(Template)]` whose body uses `{% for %}` / `{% scope sub %}` over a
  `#[derive(Trussbars)]` field, proving the two derives compose.
- A `trybuild` golden: a derived template with an unknown helper is a located `compile_error!`.
- **Clause coverage (§5.2, required):** `helpers` / `truthiness` / `partials` on a derived template
  match the corresponding `truss!` tests byte-for-byte (the derive forwards to the same emitter).
