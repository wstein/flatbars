# Trussbars — `#[derive(Template)]` ergonomics (#5)

> **Status:** Proposed / design note — *decisions required before implementation.*
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
```

- The struct's **fields are the context** — `{{title}}` is `self.title` — so no `CtxType`
  argument: `Self` *is* the type. Exactly one of `source` / `path` is required.
- The `path` form reads at expansion time (relative to `CARGO_MANIFEST_DIR`, like `truss!`'s
  `path =`) and `include_bytes!`-tracks the file.
- Generates `impl trussbars_core::Template for Page` (with `fn render(&self) -> String`) **and**
  `impl core::fmt::Display for Page` (writing the rendered output), so a `Page` formats with
  `{}` and composes into other templates as a value.
- A class-A error (parse / unknown helper / unsupported) is a located `compile_error!`, exactly
  as for `truss!` — the derive funnels through the same emitter.

## 3. The trait (in `trussbars-core`)

```rust
pub trait Template {
    /// Render to an owned `String` (HTML-escaped per the engine's rules).
    fn render(&self) -> String;
}
```

The derive also emits `impl Display`:

```rust
impl core::fmt::Display for Page {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(&self.render())
    }
}
```

(Trade-off noted for §5: a `render(&self) -> String` is the minimal, allocating shape; Askama
also offers `render_into(&mut impl fmt::Write)` to avoid the intermediate `String`. v1 proposes
`-> String` only; `render_into` is an additive follow-up if a no-alloc path is wanted.)

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
       fn render(&self) -> String {
           #emitted_fn               // `fn __render(ctx: &Page) -> String { … }` (pub stripped)
           __render(self)
       }
   }
   impl Display for Page { /* writes render() */ }
   ```

   The emitter always prefixes `pub fn`; the derive strips the leading `pub ` (or we add a
   private-fn emitter entry point — an implementation detail, not a surface decision).

This adds a `trussbars-derive → trussbars-template` build-dependency (compile-time only;
nothing new at runtime). The emitted body still links `trussbars-core`/`trussbars-std`, exactly
like `truss!`.

**Relationship to `#[derive(Trussbars)]`:** unchanged. `#[derive(Template)]` makes a type
*renderable*; `#[derive(Trussbars)]` makes a type usable as a truthy/sub-context value
(`{{#with sub}}`, `{{#if this}}`). A leaf struct rendered at top level needs only `Template`; a
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

## 5. Decisions required before building

1. **`render` signature:** `fn render(&self) -> String` only (recommended, minimal), or also
   generate `render_into(&mut impl fmt::Write)` (no intermediate `String`)?
2. **v1 attribute scope — tuning clauses.** Beyond `source`/`path`, should `#[template(…)]` also
   accept `helpers = [...]`, `truthiness = …`, and `partials = [...]` (parity with `truss!`)?
   - **(a)** `source`/`path` only for v1; tuning clauses are a follow-up *(recommended — ships
     the ergonomic win now; the clauses are mechanical to add later)*.
   - **(b)** Full parity now (more attribute-parsing + tests up front).
3. Confirm the trait lives in `trussbars-core` as `Template { fn render(&self) -> String; }` and
   the derive also generates `Display`.

## 6. Test plan (once decided)

- `trussbars-derive` render tests: an inline `source` struct and a `path` struct both `.render()`
  to the expected bytes; `format!("{}", page)` (Display) matches `render()`.
- A nested case: a `#[derive(Template)]` whose body uses `{{#each}}` / `{{#with sub}}` over a
  `#[derive(Trussbars)]` field, proving the two derives compose.
- A `trybuild` golden: a derived template with an unknown helper is a located `compile_error!`.
- (If §6.2b) clause coverage mirroring `truss!`'s helpers/truthiness/partials tests.
