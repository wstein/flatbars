# lab — the Trussbars **VM** northstar (live-editing TUI + i18n)

A [ratatui](https://ratatui.rs) terminal mini-Lab (over the crossterm backend) built on
[`trussbars-vm`](../../crates/trussbars-vm). Where `blog`/`changelog` showcase the **AOT**
path (`truss!` compiles templates at build time), this showcases what AOT structurally
*can't* do: **edit a template and its data at runtime and re-render live.**

```sh
cargo run --bin lab            # the TUI — edit, then cycle locale/mode/sample
cargo run --bin lab -- --demo  # headless: print every sample × locale × mode
cargo test                     # editor + json units, the golden matrix, a TestBackend smoke
```

## Controls

| Key | Action |
| --- | --- |
| type / arrows / Backspace / Enter | edit the focused pane |
| `Tab` | switch focus (Template ⇄ Data) |
| `F2` | cycle locale (en → de → fr) |
| `F3` | toggle mode (`render` ⇄ `render_compat`) |
| `F4` | load the next sample (reseeds both panes) |
| `Esc` / `Ctrl-Q` | quit |

The **Template** and **Data (JSON)** panes are live-editable; the **Output** pane
re-renders through the VM on every keystroke.

## What it proves (straight from `docs/11`)

1. **The VM leads AOT on host helpers & i18n (§8).** The `receipt` sample calls
   `{{t …}}` / `{{number …}}` / `{{plural …}}` / `{{date …}}` / `{{relative …}}` — host
   helpers registered at runtime in [`src/i18n.rs`](src/i18n.rs), with the language taken
   from the lab's locale. Press `F2` and the title, plural noun, grouped number, and
   **localized month name** all change:

   ```text
   == Receipt ==              == Beleg ==              == Reçu ==
   Total: 899.00  (1 item)    Summe: 899.00 (1 Artikel)  Total: 899.00 (1 article)
   Placed: 09 June 2026       Erstellt: 09 Juni 2026     Établi: 09 juin 2026
   ETA: in 3 days             Lieferung: in 3 days       Livraison: in 3 days
   ```

   Bump `count` in the Data pane to watch the plural switch (en items / fr articles;
   German `Artikel` is invariant).

2. **`render_compat` is the AOT-parity proxy (§7).** Press `F3`:
   - `receipt` → `⟂ unsupported: helper 't'` — host helpers are VM-only.
   - `greeting` → **byte-identical** to lenient — it localizes the AOT-friendly way (the
     data already holds the translated strings), so it needs no helpers.

## i18n boundary (`docs/09 §5`)

`trussbars-i18n` owns the *format primitives* (`number`/`date`/`selectPlural`/`relative`);
the **host owns the message catalog** for `t`. The VM's `Helpers::register` takes
`Fn(&[Value]) -> Result<Value, String>`, which is a runtime ABI — so the `&[Value]` shims
over the typed i18n pack live here in the host, not in `trussbars-i18n` (which must stay
VM-agnostic for the AOT path). [`src/i18n.rs`](src/i18n.rs) is self-contained so it can be
promoted to a `trussbars-vm-i18n` bridge crate if a second VM host ever needs it.

## Dependencies — a deliberate trade-off

Unlike the other examples (path-deps only), this one pulls **`ratatui`** + **`crossterm`**
(the TUI) and **`serde_json`** (to decode the live-edited Data pane). That is the cost of
a *real, editable* northstar rather than a print loop — taken knowingly. It lives in its
own workspace, so the core crates' dependency-free, `forbid(unsafe)` posture is untouched;
only this example carries the TUI tree.

## Layout

| File | Role |
| --- | --- |
| [`src/lib.rs`](src/lib.rs) | `Lab` state, the pure `render()` core, and the `ui()` draw |
| [`src/editor.rs`](src/editor.rs) | `TextBuffer` — a pure char-cursor multiline editor (unit-tested) |
| [`src/json.rs`](src/json.rs) | decode the Data pane (JSON) into the VM's `Value` |
| [`src/i18n.rs`](src/i18n.rs) | `&[Value]` shims over `trussbars-i18n` + the host catalog |
| [`src/samples.rs`](src/samples.rs) | the two seed templates + their seed JSON data |
| [`src/main.rs`](src/main.rs) | the crossterm/ratatui event loop + `--demo` / `--bless` |
| [`tests/`](tests/) | the golden matrix, the plural-switch test, and a `TestBackend` UI smoke |

Regenerate the golden snapshots after an intentional change with
`cargo run --bin lab -- --bless tests/golden`.
