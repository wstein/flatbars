# vm-hotreload — the VM hot-reload northstar

Render cross-file `.truss` templates through the **bytecode VM**, recompiling them from disk on
every render — so editing a template changes the output of a *running* process, with **no Rust
rebuild**. This is the runtime-template capability the compile-time AOT path (`truss!`) structurally
can't have (there the template source is baked into the binary). See `docs/24`.

The whole pattern is [`Reloader`](src/lib.rs): hold a templates directory; each `render()` re-reads
`page.truss` (which `{% extends "layout" %}`) plus `layout.truss` and recompiles via
`Program::compile_with_partials` (the cross-file-partials VM constructor).

## Two modes

```sh
cargo run                 # scripted demo: render, edit the page, edit the shared base — one
                          # process, three renders, zero rebuilds (deterministic; CI runs the tests)

cargo run -- --watch      # live: seed an editable scratch dir, then re-render on every save
cargo run -- --watch DIR  # live: watch your own templates dir (needs layout.truss + page.truss)
```

The `--watch` mode uses the [`notify`](https://crates.io/crates/notify) filesystem watcher; open
the printed directory in your editor, change `layout.truss` or `page.truss`, and each save
re-renders. Ctrl-C to stop.

## Tests

`cargo test` asserts a hot **page** edit and a hot **base** edit both take effect mid-process, the
seeded templates render (override + base chrome + the `{% for %}` loop), and a malformed edit is a
recoverable error rather than a panic.
