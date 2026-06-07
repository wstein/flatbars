# trussbars-core

The value-free runtime substrate that compiled **Trussbars** templates link
against.

Trussbars is the statically-typed subset of MaxBars compiled ahead-of-time to
straight-line Rust — **no interpreter, no `Value` enum, no string-keyed dispatch**
at render time. The compiler emits native field accesses, `if`/`for`, and calls
into the small surface this crate provides.

## Surface

- **Output** — `Safe`, the `ToText` stringification trait, `escape_html`, and
  `esc`. Stringification mirrors the reference engine's `stringify`; escaping
  mirrors its `escapeHtml`, byte-for-byte. A context struct has no `ToText` impl,
  so `{{struct}}` is a compile error.
- **Truthiness** — `Truthy` / `truthy`, the `nonEmpty` rule for non-numeric types.
  Numbers have no impl, so a bare-number condition (`{{#if count}}`) does not
  compile — write `{{#if count > 0}}`.
- **Loop frames** — `Loop`, the per-iteration `{{#each}}` metadata, threaded as
  borrowed references through lexical scopes (no `Rc`, no heap frame).

## Design

The contract lives in `../../docs/`:

| Doc | Covers |
| --- | --- |
| `01-subset-spec.md` | the Trussbars language and its data contract |
| `02-runtime-api.md` | this crate's surface (keep in lockstep) |
| `03-schema-inference.md` | deriving the context type from a template |
| `04-conformance.md` | the cross-language byte-identity harness |

## Features

- `derive` *(off by default)* — re-exports `#[derive(Trussbars)]` from
  `trussbars-derive`, so a host can depend on `trussbars-core` alone.

## Properties

- **std-only, zero runtime dependencies** by default — builds offline; a small,
  auditable substrate. The optional `derive` feature pulls the proc-macro
  (build-time only).
- `#![forbid(unsafe_code)]`, `#![deny(missing_docs)]`, `clippy::all` denied
  (workspace lints).
- Toolchain pinned to Rust 1.96 (`../../rust-toolchain.toml`), edition 2024.

## Develop

```sh
cargo +1.96.0 test   --manifest-path trussbars/Cargo.toml --all-features
cargo +1.96.0 fmt    --manifest-path trussbars/Cargo.toml --all
cargo +1.96.0 clippy --manifest-path trussbars/Cargo.toml --all-targets --all-features
```
