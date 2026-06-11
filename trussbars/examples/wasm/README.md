# wasm — Trussbars in a no_std WASM module (the N1 portability proof)

The strategy review (docs/24) found the one empty room for a Rust template engine: **`no_std` +
WASM** text/config generation, where Askama, Sailfish, and minijinja all pull `std` and so don't
compete. That portability was *asserted* but not *demonstrated*. This crate demonstrates it: the
bytecode VM (`trussbars-vm`, `no_std + alloc + #![forbid(unsafe_code)]`) renders a device-status
page inside a bare `wasm32-unknown-unknown` module — no interpreter to initialize, the injection law
intact.

```sh
# the portability proof: the no_std VM compiles + links as a wasm module
cargo build --target wasm32-unknown-unknown --release
#   → target/wasm32-unknown-unknown/release/trussbars_wasm.wasm  (exports `render_status`)

# the logic proof: the same render path, asserted byte-for-byte (and injection-law-in-wasm)
cargo test
```

`src/lib.rs` is the whole thing: a `STATUS` template, a `status_page(..)` render fn (shared by both
builds), the `no_std` wasm runtime bits (a `dlmalloc` global allocator + an abort panic handler,
both `#[cfg(target_arch = "wasm32")]`), and a `render_status` export a host (Spin, a Cloudflare
Worker, a browser, `wasmtime`) calls — it returns a packed `(ptr << 32) | len` into the module's
linear memory.

CI builds the wasm target **and** runs the native tests (`.github/workflows/trussbars.yml`, the
`wasm` job), so neither the portability nor the output can regress.

**Scope (N1 is a flag, not a market — docs/24).** This proves the claim; it is deliberately small.
A full Spin/Cloudflare component with the host-side glue is the obvious next step, but N1 spend is
frozen here per the review — the value is the demonstrated capability, not a product.
