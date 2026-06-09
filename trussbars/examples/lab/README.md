# lab — the Trussbars **VM** northstar (live-editing TUI + i18n)

A [ratatui](https://ratatui.rs) terminal mini-Lab (over the crossterm backend) built on
[`trussbars-vm`](../../crates/trussbars-vm). Where `blog`/`changelog` showcase the **AOT**
path (`truss!` compiles templates at build time), this showcases what AOT structurally
*can't* do: **edit a template, its data, and its translations at runtime and re-render
live.**

```sh
cargo run --bin lab            # the TUI — edit a pane, cycle locale/mode/sample
cargo run --bin lab -- --demo  # headless: print every sample × locale × mode
cargo test                     # editor + data units, the golden matrix, a TestBackend smoke
```

## Controls

| Key / mouse | Action |
| --- | --- |
| type / arrows / Backspace / Enter | edit the focused pane |
| left-click / drag | focus a pane + place the caret / select text |
| `Tab` | cycle focus (Template → Data → i18n) |
| wheel / `PageUp` / `PageDown` | scroll the pane under the cursor / the focused pane |
| `F2` | cycle locale (en → de → fr → **pl**) |
| `F3` | toggle render mode (`render` ⇄ `render_compat`) |
| `F4` | load the next sample (reseeds Template + Data; keeps the catalog) |
| `Esc` / `Ctrl-Q` | quit |

The screen is a 2×2 grid; the three editable panes feed the Output, which re-renders
through the VM on every keystroke:

```text
 Template │ Data (YAML)
──────────┼──────────────
 Output   │ i18n catalog (YAML)
```

The three editable panes are [`tui-textarea`](https://crates.io/crates/tui-textarea-2)
widgets — a full editing experience (mouse caret + selection, undo/redo, word motions,
internal scrolling). They feed the read-only Output, which re-renders on every keystroke.
The **Template** pane is **syntax-highlighted**: the engine lexer ([`src/highlight.rs`](src/highlight.rs))
colours each `{{ … }}` tag by sigil and applies it through tui-textarea's custom-highlight
API (so it stays correct under scrolling and selection).

## What it proves (straight from `docs/11`)

1. **The VM leads AOT on host helpers & i18n (§8).** The `receipt` sample calls
   `{{t …}}` / `{{number …}}` / `{{plural …}}` / `{{date …}}` / `{{relative …}}` — host
   helpers registered at runtime in [`src/i18n.rs`](src/i18n.rs), with the language taken
   from the lab's locale and the messages from the **editable catalog pane**. Press `F2`
   and the localized dimensions change — the **title**, the **plural noun**, and the
   **localized month name**:

   ```text
   == Receipt ==              == Beleg ==                == Paragon ==
   Total: 899.00  (1 item)    Summe: 899.00 (1 Artikel)  Suma: 899.00 (1 element)
   Placed: 09 June 2026       Erstellt: 09 Juni 2026     Wystawiono: 09 czerwiec 2026
   ```

   Number grouping (`899.00`) and `relative` phrasing (`in 3 days`) are **en-US
   fallbacks** — invariant across locales, as the output above shows; locale-aware
   separators belong in `trussbars-i18n`, not this host shim (a tracked follow-up).
   Bump `count` in the Data pane to watch the plural switch. Polish exercises CLDR's
   four cardinal forms — `1 element`, `3 elementy`, `5 elementów` — while German
   `Artikel` is invariant. Edit a message in the i18n pane and the render updates live.

2. **`render_compat` is the AOT-parity proxy (§7).** Press `F3`:
   - `receipt` → `⟂ unsupported: helper 't' / 1 args` — host helpers are VM-only.
   - `greeting` → **byte-identical** to lenient. It uses no i18n (plain `{{field}}`
     interpolation), so it carries no helpers — and the lab hides the i18n pane for it,
     giving the Output the full bottom row.

For the **data-driven catalog** pattern (catalog as data, looked up by declared helpers,
identical on AOT + VM), see the focused [`i18n-data`](../i18n-data) example.

## The two samples

| Sample | Pattern | Modes | i18n Pane |
| --- | --- | --- | --- |
| **receipt** | Helper-based i18n: `{{t …}}`, `{{number …}}`, `{{plural …}}`, `{{date …}}`, `{{relative …}}` | render only (VM-exclusive) | visible ✓ |
| **greeting** | Plain data interpolation: `{{field}}` (no i18n) | render + compat (AOT-compatible) | hidden |

Cycle samples with `F4`. The **receipt** uses host helpers from `src/i18n.rs` that must be
registered at runtime — VM-only, rejected by `render_compat`. The **greeting** is pure data
interpolation, so it works on both backends.

## i18n boundary (`docs/09 §5`)

`trussbars-i18n` owns the *format primitives* (`number`/`date`/`selectPlural`/`relative`,
including CLDR plural categories and localized month names); the **host owns the message
catalog** for `t` — here, the live-editable i18n pane (YAML, `locale → key → message`).
The VM's `Helpers::register` takes `Fn(&[Value]) -> Result<Value, String>`, a runtime ABI,
so the `&[Value]` shims over the typed i18n pack live here in the host, not in
`trussbars-i18n` (which must stay VM-agnostic for the AOT path). [`src/i18n.rs`](src/i18n.rs)
is self-contained so it can be promoted to a `trussbars-vm-i18n` bridge crate.

## Dependencies — a deliberate trade-off

Unlike the other examples (path-deps only), this one pulls the editing TUI
(**`ratatui`**, **`crossterm`**, **`tui-textarea`**) and **`serde_yaml`** (to decode the
live-edited Data and catalog panes); syntax highlighting reuses the engine's own
`trussbars-template` lexer. That is the cost of a *real, editable* northstar rather than a
print loop — taken knowingly. It lives in its own workspace, so the core crates'
dependency-free, `forbid(unsafe)` posture is untouched; only this example carries the TUI
tree.

## Layout

| File | Role |
| --- | --- |
| [`src/lib.rs`](src/lib.rs) | `Lab` state, the pure `render()` core, and the `ui()` draw |
| [`src/highlight.rs`](src/highlight.rs) | lexer-driven Template highlighting via tui-textarea custom highlights |
| [`src/data.rs`](src/data.rs) | decode the Data pane (YAML) into the VM's `Value` |
| [`src/i18n.rs`](src/i18n.rs) | `&[Value]` shims over `trussbars-i18n` + the editable catalog + its seed |
| [`src/samples.rs`](src/samples.rs) | two seed templates + their seed YAML data |
| [`src/main.rs`](src/main.rs) | the crossterm/ratatui event loop + `--demo` / `--bless` |
| [`tests/`](tests/) | the golden matrix, plural/catalog/error tests, and a `TestBackend` UI smoke |

Regenerate the golden snapshots after an intentional change with
`cargo run --bin lab -- --bless tests/golden`.
