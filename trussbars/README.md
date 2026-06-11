# Trussbars

**A statically-typed Handlebars/Mustache-family template *compiler* for Rust.** A
`.truss` template is compiled — at macro-expansion time, by `rustc` — into a
monomorphized `fn render(ctx: &T) -> String`. There is no interpreter, no runtime AST
walk, and no `Value` boxing: `{{user.name}}` becomes the field load `ctx.user.name`.

> A *truss* is a rigid framework of bars — statically determinate, load-bearing, fixed at
> build time, nothing shifts under load. You *truss* a [MaxBars][maxbars] template into
> compiled Rust.

```rust
use trussbars_macros::truss;

#[derive(trussbars_core::Trussbars)]
struct Greeting { name: String, shout: bool }

truss!(greeting, Greeting, "Hello {{name}}{{#if shout}}!{{/if}}");

// expands to: pub fn greeting(ctx: &Greeting) -> String { … }
let s = greeting(&Greeting { name: "world".into(), shout: true });
assert_eq!(s, "Hello world!");
```

## A different artifact, not a faster Liquid

Trussbars is often compared to runtime engines (Handlebars, Liquid, the dynamic FlatBars
dialects). The comparison is a category error: those treat a template as **data** loaded
and walked at render time; Trussbars treats it as **source** compiled ahead of time. Every
downstream difference follows from that one choice. Compare *fitness for a use case*, not
feature checklists.

| You need… | Use |
| --- | --- |
| User-authored / runtime-loaded templates (CMS, theming, email-from-DB, live editing) | A **runtime** engine — Liquid, Handlebars, or the dynamic FlatBars/MaxBars dialects |
| Hot-reload a template without recompiling; one process serving many tenants' templates | A **runtime** engine |
| Schemaless data (an undeclared JSON blob, no context type) | The dynamic MaxBars engine ([`flatbars`][flatbars]) |
| Developer-authored, compiled, typed view layer in a Rust binary | **Trussbars** |
| Missing keys / wrong types / unknown helpers caught at build time, not render time | **Trussbars** |
| Lowest render latency and zero per-render allocation on a hot path | **Trussbars** (the cost moves to `rustc`: compile time + binary size) |

The trade is iteration speed vs. execution speed, and Trussbars chooses execution: changing
a template means recompiling. That is the right choice for a developer-authored view layer
and the wrong one for anything user-authored.

## Security: it sandboxes the *data*

The two designs are **duals, neither is "more secure"**:

> **A runtime engine sandboxes the template** (the author is untrusted — the template
> literally cannot reach `eval`). **Trussbars sandboxes the data** (the data is untrusted —
> no value may ever become a name).

Trussbars' organizing law is *names are static, data is dynamic, the two never cross*
([docs/01 §1][spec]). This removes the **name-injection** hazard sub-class outright: data
can no longer choose which partial, helper, or field a render reaches — the
SSTI / confused-deputy shape (`{{> (lookup this "kind")}}`, `apply`, computed `lookup`) is a
**compile error**, pinned by a `trybuild` diagnostics corpus.

It is **not** a claim to have solved all template security. **Resource exhaustion (DoS) is
explicitly out of scope**: a compiled `for` over an attacker-sized collection is unbounded
just like an interpreted one — "compiled" buys nothing here. The bound belongs at the input
seam (cap the request body, rely on `serde`'s recursion limit, use bounded collection types
before deserializing into `T`). See [docs/01 §10][spec].

## Status

**Pre-1.0, research-grade.** `0.1.0`, **not yet published to crates.io**.

- **Conformance:** `71/71` byte-identical against the MaxBars reference interpreter
  (`conformance/report.json` — the single source; `ecma-float` profile, 0 excluded, 0
  oracle drift).
- **Correctness still rides a PureScript oracle.** Trussbars is defined as the typed subset
  of MaxBars and adjudicated by the FlatBars interpreter in the parent repo. Severing that
  oracle is gated (G1–G5) by [docs/13][independence]; schema inference ([docs/03][infer]) is
  on the critical path.
- **MSRV / edition.** Rust **1.96**, **edition 2024** — a deliberate floor, aggressive for
  broad adoption (stated so the consumer requirement is explicit).
- **Tooling** is ~30%: the `truss!` proc-macro, located class-A diagnostics, host helpers,
  selectable truthiness policies (`truss!(…, truthiness = …)`, [docs/16](docs/16-truthiness-modes.md)),
  and a VM backend ship; a type-aware LSP and the foreign-dialect migration tool lead the
  post-severance build-out.

## Workspace

| Crate | Role |
| --- | --- |
| [`trussbars-template`](crates/trussbars-template) | The front end: lexer → parser → desugar → Rust emit (the v2 engine). |
| [`trussbars-macros`](crates/trussbars-macros) | The `truss!` proc-macro — compiles a template to a typed render fn; owns class-A diagnostics. |
| [`trussbars-core`](crates/trussbars-core) | Runtime: `Safe`/`ToText`/`escape_html`, `nonEmpty` `Truthy` (minus numbers), the `Loop` frame, `SizeHint`. `no_std + alloc`. |
| [`trussbars-std`](crates/trussbars-std) | The prelude/stdlib operations as monomorphized functions (string / number / array packs). |
| [`trussbars-derive`](crates/trussbars-derive) | `#[derive(Trussbars)]` — the `Truthy` impl for context structs. |
| [`trussbars-interp`](crates/trussbars-interp) | The dynamic **tree-walk interpreter** backend (runtime templates, same no-data-derived-names law) — the reference dynamic backend the VM is byte-identical to; `no_std + alloc`. |
| [`trussbars-vm`](crates/trussbars-vm) | The dynamic **bytecode VM** backend: a flat bytecode skeleton over the shared `trussbars-interp` engine (`if`/`each` structure as bytecode; general expressions + rarer blocks via the shared `eval_expr`/`eval_nodes`), with a borrow-based fast-path for the hot path/loop case. **First-class, full coverage** — compiles every valid template, byte-identical to the interpreter, ~1.6× (big-table)–2.3× (teams) faster (docs/11 §4.3). |
| [`trussbars-import`](crates/trussbars-import) | Migration **read half**: Mustache / Handlebars / Liquid / StringTemplate4 → faithful spanned ASTs. |
| [`trussbars-i18n`](crates/trussbars-i18n) | The host-locale translator seam (English fallback). |

## Documentation

The normative language and design docs live in [`docs/`](docs):
[`01` subset spec][spec] · [`02` runtime API](docs/02-runtime-api.md) ·
[`03` schema inference][infer] · [`04` conformance](docs/04-conformance.md) ·
[`11` VM backend](docs/11-vm-backend.md) · [`13` independence][independence] ·
[`15` migration import](docs/15-migration-import.md) ·
[`16` truthiness modes](docs/16-truthiness-modes.md). Start with the
[roadmap](docs/00-roadmap.md).

## License

Apache-2.0.

[maxbars]: ../packages/maxbars
[flatbars]: ../packages/flatbars
[spec]: docs/01-subset-spec.md
[infer]: docs/03-schema-inference.md
[independence]: docs/13-independence.md
