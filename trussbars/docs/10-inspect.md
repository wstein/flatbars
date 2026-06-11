# Trussbars — Inspect / Provenance (design, keep-in-mind for v2)

> **Status:** Requirement captured pre-v2 · **Audience:** the v2 author.
> **Goal:** a Trussbars **inspector** like StringTemplate4's STViz — render a template
> with data and *see* how each piece of output maps back to the template, plus the
> render context at any point. **The FlatBars Lab is the UX blueprint** (it already
> does this for the interpreter); Trussbars should feed the *same* UI.

## 1. What the interpreter already has (ADR-035) — and must be matched

The reference engine ships two introspection products the Lab consumes:

- **Provenance / source map** — `Kernel.Provenance.runResolvedMapped` →
  `{ output, segments }`, where each `Segment` tiles an **output byte range** to its
  originating **template span** (`{file, span, text}`; literal runs carry no span,
  emit runs do). `assemble` verifies the segments reconstruct the output exactly, so
  the map is a true tiling. Gated by `check:provenance`.
- **Context Inspector** — `Kernel.Inspect.inspectResolvedLenient target → [Snapshot]`,
  where a `Snapshot` at a target span is the render context there:
  `this / parent / root / index / index1 / key / first / last / locals`
  (block-param bindings).

The Lab links these three ways: **template ↔ output ↔ context**. Trussbars inspect =
the same three-way linking, produced by the *compiled* engine.

## 2. The catch: Trussbars is compiled (no interpreter, no runtime AST)

There is no `Value` tree and no interpret loop to instrument with a `WriterT`. So the
map and the snapshot must be produced **by the generated Rust at render time**. The
good news: the emitter already tracks template spans per node — the
`compileMaxRustCommented` breadcrumbs (`docs/07`) are the *static* source map
(code ↔ template), and that work already proved **spans survive desugar and tile
cleanly**. Inspect is the *runtime* version of the same data.

## 3. Design — two provenance emit modes, mirroring ADR-035

A fourth emitter mode (after clean / commented / error-breadcrumb): **provenance**.

### 3a. Source map (output ↔ template) — the cheap, high-value half

The generated `render` returns the output **plus a tiling segment list**, mirroring
`runResolvedMapped`'s `{ output, segments }`:

```rust
// provenance mode — conceptual
pub fn render_mapped(ctx: &Ctx) -> (String, Vec<trussbars_core::Segment>) {
    let mut out = String::new();
    let mut seg = trussbars_core::SegSink::new(&mut out);
    seg.text("<h1>");                                    // literal run, no span
    seg.emit(Span{1,5}, |o| esc(&ctx.site.title, o));    // emit run → template span
    …
}
```

`SegSink` records each run's `(output_range, Option<Span>)` as it writes — the exact
`Segment` shape the Lab already renders. Literal runs get `None`; `esc`/value runs
get the node's span. This is a mechanical pass over the *same* per-node spans the
breadcrumbs use. A `check:provenance`-analog asserts the segments tile the output
(like the interpreter's gate).

### 3b. Context Inspector (this / parent / root / locals at a span) — the harder half

The interpreter's `Snapshot` fields are dynamic `Value`s. Trussbars' `this` is a
**typed** `&Post` (or a block-param `__c1`), so to snapshot it we **serialize** it:

```rust
// inspect mode, at a target span — conceptual
fn inspect_at(ctx: &Ctx) -> Vec<Snapshot> {
    // …reach the target loop iteration…
    snapshot.push(Snapshot {
        this: serde_json::to_value(__c1)?,
        parent: serde_json::to_value(__c0)?,
        root: serde_json::to_value(__root)?,
        index1, key, first, last,                  // from the live Loop frame
        locals: vec![("post", to_value(__c1)?)],
    });
}
```

So the Context Inspector needs the **context types to be `Serialize`** (they already
`Deserialize` for the harness — add `Serialize`, or a feature). The emitter, in
inspect mode, captures the in-scope bindings at the target span into the snapshot.
This is heavier than 3a and depends on serde; do it second.

## 4. Data-shape parity with the Lab (the blueprint)

The win is reusing the Lab UI. So the Trussbars provenance/inspect output should be
the **same JSON shapes** the Lab already consumes for the interpreter:
`{ output, segments: [{start, end, span?, text}] }` and the `Snapshot` record.
Trussbars then plugs into the Lab as a second engine behind the same panels
(template highlight ↔ output highlight ↔ context), with a toggle "interpreter /
compiled". STViz parity comes for free from the Lab's existing three-way linking.

## 5. What this means for v2 (the keep-in-mind)

1. **Spans are load-bearing twice over** — for diagnostics (`docs/07`) *and* for
   inspect. The v2 parser must thread byte-spans through parse → desugar → emit
   (already required; inspect raises the stakes).
2. **Design the provenance emit mode alongside clean/commented from the start** —
   not bolted on. It's the runtime twin of the breadcrumbs; share the per-node span
   plumbing.
3. **`trussbars-core` gains** a `Segment` type + a `SegSink` (3a) and, for 3b, the
   inspect `Snapshot` type. Behind a feature, so the lean render path is untouched.
4. **Context types want `Serialize`** for 3b — fold into `#[derive(Trussbars)]` or a
   sibling, gated so non-inspect builds don't pay for it.
5. **A `check:provenance`-analog gate** — the compiled segments must tile the output
   for the corpus, exactly as the interpreter's does.

## 6. Phasing

- **Phase 1 — source map (3a).** Cheap (reuses span infra), high value, gives the
  template↔output linking that is the bulk of STViz's appeal. Lab-pluggable.
- **Phase 2 — context inspector (3b).** Adds `this/parent/root/locals`; needs serde
  `Serialize`. Completes the three-way linking.

Phase 1 is a natural follow-on to the breadcrumb work and could even land in v1's
PureScript emitter as a `compileMaxRustMapped` variant (another `Env.mode`),
de-risking the v2 design — same way the commented mode prefigured the diagnostics.

## Implemented — `trussbars_vm::inspect` (the in-code entry point)

Phase 1 shipped on the **VM** (not the AOT emitter), because the decisive requirement
is *inspect-my-app, invoked in code*: the Studio is a **viewer of inspections your app
produces**, so it runs in-process with your data and your registered helpers — which
sidesteps the "custom helpers must be compiled" wall entirely (they ran here; the
viewer only displays the result).

`inspect(template, &data, &helpers) -> Inspection` captures, in one call:
- the lenient **output** (+ `rendered`);
- **data→output provenance** — `interpolations: Vec<Interp>`, each `{{ }}`'s template
  byte span → the output byte range it produced → the raw value. A looped `{{x}}` maps
  to *one* template span and *many* output runs (the STViz core);
- the **AOT-compat verdict** (`aot_compat_ok` + the rejection reason) — would this
  compile under AOT, identically? (the verifying proxy);
- the **emitted Rust** the AOT backend would generate.

`Inspection::to_json()` (dependency-free) feeds the Studio viewer; the `truss-interp
--inspect` CLI prints it. Delivery modes (docs/11 §10): (A) dump-and-load JSON, (B) an
app-served local Studio that re-`inspect`s in-process on edit. **Phase 2** (the context
inspector — `this`/`parent`/`root`/locals at a span) is the next layer on the same
trace mechanism.
