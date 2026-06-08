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
| **Sailfish** | ~0.42 µs | **0.5×** (≈2.2× faster) | compile-time, but embeds **raw Rust** in templates — no injection-safety boundary |
| **Trussbars** | ~0.92 µs | 1.0× | compile-time, **typed + injection-safe** (no data-derived dispatch) |
| **Askama** | ~1.71 µs | 1.9× slower | compile-time, typed, safe |
| **handlebars** | ~33.0 µs | **36× slower** | runtime interpreter (parse + walk per render) |

## Takeaways

- **~36× over the dynamic interpreter** (handlebars): the compile-time-codegen
  advantage — Trussbars emits straight-line Rust, handlebars parses and walks an
  AST every render. This is the bulk of the "fast template engine" story, and
  Trussbars has it by construction.
- **Beats Askama (~1.9×)** — best-in-class among the *injection-safe* typed
  engines, from the lean codegen plus the `itoa` / `dragonbox_ecma` formatting
  backends (`dragonbox_ecma` is fast *and* ECMA-byte-identical).
- **Within ~2.2× of Sailfish** — the absolute fastest, which gets there partly by
  letting templates embed arbitrary Rust (`<%= expr %>`): great for speed, but it
  dissolves the injection-safety boundary that is Trussbars's reason to exist
  (the debate's explicit non-adoption). Trussbars stays in the same order of
  magnitude while keeping that boundary.

## Notes

- The engine setups live in `src/lib.rs` (shared by the bench and the gate); the
  Trussbars column is the **verbatim** output of `compileMaxRust`.
- Sailfish needs `self.`-qualified fields in its `.stpl` (`templates/items.stpl`).
- **Perf-regression gate:** `tests/perf_gate.rs` asserts the machine-independent
  relative invariants (Trussbars ≤ Askama, Trussbars × 5 ≤ handlebars), measured in
  one run so a slow CI box doesn't matter; meaningful only in release, so it
  self-skips in debug. Run it with `cargo +1.96.0 test --release --manifest-path
  trussbars/benchmarks/Cargo.toml`; CI runs it as the `benchmarks` job in
  `trussbars.yml`.
