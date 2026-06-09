# lab — the Trussbars **VM** northstar (dynamic render + i18n)

A dependency-free terminal mini-Lab built on [`trussbars-vm`](../../crates/trussbars-vm).
Where `blog`/`changelog` showcase the **AOT** path (`truss!` compiles templates at build
time), this showcases what AOT structurally *can't* do: **parse and render a template
against data at runtime**, and switch locale/mode live.

```sh
cargo run --bin lab            # interactive TUI: [s]ample [l]ocale [m]ode [q]uit
cargo run --bin lab -- --demo  # headless: print every sample × locale × mode
cargo test                     # the golden gate over that whole matrix
```

## What it proves (straight from `docs/11`)

1. **The VM leads AOT on host helpers & i18n (§8).** The `receipt` sample calls
   `{{t …}}` / `{{number …}}` / `{{plural …}}` / `{{date …}}` — host helpers registered
   at runtime in [`src/i18n.rs`](src/i18n.rs). Cycle the locale and the title, the plural
   noun, the grouped number, and the date format all change:

   ```
   == Receipt ==            == Beleg ==              == Reçu ==
   Total: 1,311.80 (3 items)  Summe: 1,311.80 (3 Artikel)  Total: 1,311.80 (3 articles)
   Placed: Jun 09, 2026       Erstellt: 09.06.2026         Établi: 09/06/2026
   ```

2. **`render_compat` is the AOT-parity proxy (§7).** Toggle to compat mode:
   - `receipt` → `⟂ AOT-rejected: unsupported: helper 't'` — host helpers are VM-only.
   - `greeting` → **byte-identical** to lenient — it localizes the AOT-friendly way (the
     host bakes already-translated strings into the data), so it needs no helpers.

## i18n boundary (`docs/09 §5`)

`trussbars-i18n` owns the *format primitives* (`number`/`date`/`selectPlural`); the **host
owns the message catalog** for `t`. The VM's `Helpers::register` takes
`Fn(&[Value]) -> Result<Value, String>`, which is a runtime ABI — so the `&[Value]` shims
over the typed i18n pack live here in the host, not in `trussbars-i18n` (which must stay
VM-agnostic for the AOT path). [`src/i18n.rs`](src/i18n.rs) is self-contained so it can be
promoted to a `trussbars-vm-i18n` bridge crate if a second VM host ever needs it.

## Layout

| File | Role |
| --- | --- |
| [`src/lib.rs`](src/lib.rs) | `Lab { sample, locale, mode }` + the pure `render()` core |
| [`src/samples.rs`](src/samples.rs) | the two templates and their runtime `Value` data |
| [`src/i18n.rs`](src/i18n.rs) | `&[Value]` shims over `trussbars-i18n` + the host catalog |
| [`src/main.rs`](src/main.rs) | std-only ANSI TUI + `--demo` / `--bless` |
| [`tests/golden.rs`](tests/golden.rs) | snapshots every `sample × locale × mode` combo |

Regenerate the snapshots after an intentional change with
`cargo run --bin lab -- --bless tests/golden`.
