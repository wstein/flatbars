# trussbars-benchmarks

End-to-end render benchmark (the perf debate's P1): the **same** template rendered
by the Trussbars-emitted Rust, handlebars-rust (the dynamic interpreter baseline),
Askama (the typed peer), and Sailfish (the fastest reference). All four emit the
same HTML — this measures rendering, not output shape.

```sh
cargo +1.96.0 bench --manifest-path trussbars/benchmarks/Cargo.toml
```

## Results

Template: an `<h1>` + a `{{#each}}` over **50 items**, each `<li>` with an escaped
string field and an integer field. Criterion medians on this machine (Rust 1.96,
`--release`); reproduce with the command above.

| Engine | Time | vs Trussbars | Model |
| --- | --- | --- | --- |
| **Sailfish** | ~0.39 µs | **0.3×** (≈3× faster) | compile-time, but embeds **raw Rust** in templates — no injection-safety boundary |
| **Trussbars** | ~1.26 µs | 1.0× | compile-time, **typed + injection-safe** (no data-derived dispatch) |
| **Askama** | ~1.92 µs | 1.5× slower | compile-time, typed, safe |
| **handlebars** | ~33.8 µs | **27× slower** | runtime interpreter (parse + walk per render) |

## Takeaways

- **~27× over the dynamic interpreter** (handlebars): the compile-time-codegen
  advantage — Trussbars emits straight-line Rust, handlebars parses and walks an
  AST every render. This is the bulk of the "fast template engine" story, and
  Trussbars has it by construction.
- **Beats Askama (~1.5×)** — best-in-class among the *injection-safe* typed
  engines, from the lean codegen plus the `itoa` / `dragonbox_ecma` formatting
  backends (`dragonbox_ecma` is fast *and* ECMA-byte-identical).
- **Within ~3× of Sailfish** — the absolute fastest, which gets there partly by
  letting templates embed arbitrary Rust (`<%= expr %>`): great for speed, but it
  dissolves the injection-safety boundary that is Trussbars's reason to exist
  (the debate's explicit non-adoption). Trussbars stays in the same order of
  magnitude while keeping that boundary.

## Notes

- The Trussbars column is the **verbatim** output of `compileMaxRust` for the
  template, pasted into `benches/render.rs` — exactly what the codegen emits.
- Sailfish needs `self.`-qualified fields in its `.stpl` (`templates/items.stpl`).
- A perf-regression gate (criterion baselines committed + checked in CI) is a
  tracked follow-up; this crate is the manual measurement tool for now.
